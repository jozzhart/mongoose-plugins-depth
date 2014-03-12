var mongoose = require('mongoose'),
    _ = require('underscore'),
    async = require('async');


var options = {
  depth: 2
};

var findFP = function (query, opts, cb) {

  if(opts.depth === 0) return cb(null, []);
  if(_.isUndefined(this.schema.filterFields)) return cb('Model ' + that.modelName + ' is missing a filter');

  //  Check for passed in include/exlude fi
  if(!_.isUndefined(opts.includeFields)) {
    opts.depth = _getFilterDepth(opts.includeFields);
    console.log(opts.depth);
  }

  var opts = _.clone(_.defaults(opts, options));

  opts.schemaFilter = this.schema.filterFields
  opts.schemaFields = this.schema.paths;

  var modelRefFields = _getModelReferences(this);
  // Find the fields that need to be populated
  opts.populateFields = _.filter(modelRefFields, function(item){ return item.field !== '_id'; });

  this.find(query).lean().exec(function(err, results) {
    if(results == null || results.length === 0) return cb(null, null);

    //  Our recursion check point
    if(opts.depth > 1) {
      _queryChildren(results, _.clone(opts), function(err, results){
        // If we're back up to the root call do final root filter
        if(_.isUndefined(opts.isChild) && !_.isUndefined(opts.includeFields)) return cb(err, _rootFilter(results, opts));    

        cb(err, _filterResults(results, opts.schemaFilter));  
      });
    } else {
      // If we're back up to the root call do final root filter
      if(_.isUndefined(opts.isChild) && !_.isUndefined(opts.includeFields)) return cb(err, _rootFilter(results, opts));    
      
      cb(err, _filterResults(results, opts.schemaFilter));  
    }
  });
};


var findOneFP = function (query, opts, cb) {
  this.findFP(query, opts, function(err, results){
    if(results == null) return cb(err, null)
    cb(err, results[0]);
  });
};


var findByIdAndUpdateFP = function (id, body, opts, cb) {

  var model = this;
  
  model.findByIdAndUpdate(id, body, function(err, result){
    if (err) return callback (err, null);
    if (result === null) return callback (null, null);
    //  Filter and Populate
    model.findFP({ _id: result.id }, opts, function(err, results){
      if(results == null) return cb(err, null)
      cb(err, results[0]);
    });
  });
};


var saveFP = function(opts, callback) {

  var model = this;

  model.save (function (err, instance) {
    if (err) return callback (err, null);
    mongoose.model(model.constructor.modelName).findFP({ _id : instance._id}, opts, function(err, results){
      return callback (null, results[0]);  
    });
  });
};


var _queryChildren = function(results, opts, callback) {

  async.map(results, function(result, callback){

    _queryChild(result, opts, callback);

  }, function(err, results){
    callback(err, results);
  });
};



var _queryChild = function(result, opts, callback) {

  async.each(opts.populateFields, function(field, callback){
    if(_.isUndefined(mongoose.model(field.model).schema.filterFields)) return callback('Model ' + field.model + ' is missing a filter');

    var childFields = mongoose.model(field.model).schema.filterFields;

    var options = {
      depth: opts.depth - 1,
      populateFields: childFields
    };

    options.isChild = true;

    var query = { _id : result[field.field] }
    if(_.isArray(result[field.field])) {
      query = { _id : { $in : result[field.field]} }   
    }

    mongoose.model(field.model).findFP(query, _.clone(options), function(err, instances){
      if(err) return callback(err);
      if(instances === null) return callback(null);

      result[field.field] = _.map(instances, function(instance){ return _.pick(instance, childFields); });
      
      // If it is not an array, return single instance
      if(!_isModelRefArray(opts.schemaFields[field.field])) result[field.field] = result[field.field][0];

      callback(null);
    });
  }, function(err){

    callback(err, result)
    
  });
};

var _rootFilter = function(results, opts) {

  console.log(opts);

  return _.map(results, function(result) {
    return stepThroughFilter([result], opts.includeFields, opts.schemaFilter)[0];
  });

}

var stepThroughFilter = function(results, currentFields, schemaFields) {


  return _.map(results, function(result){

    if(result.id == null) 
      result.id = result._id;

    delete result._id;
    delete result.__v;


    // Check for wildcard, if so return all
    if(_.contains(currentFields, '*')) {
      return result;
    } else {
      var filterFields = _getCurrentFields(currentFields);
    }

    _.each(filterFields, function(field){
      var childFields = _getChildFields(currentFields, field);
      if(childFields.length > 0 && !_.isUndefined(result[field])) {
        if(_.isArray(result[field]))
          result[field] = stepThroughFilter(result[field], childFields);
        else
          result[field] = stepThroughFilter([result[field]], childFields)[0];
      } else {

        //  Field filter doesn't define children, so if is a Obj Ref field, just return the ids
        if(_.isArray(result[field]) && _.isObject(result[field][0]) && field !== 'id') {
          result[field] = _.map(result[field], function(field){
            return field.id;
          });
        } else if (_.isObject(result[field]) && !_.isArray(result[field]) && !_.isDate(result[field])  && field !== 'id' && !/^[0-9a-fA-F]{24}$/.test(result[field].toString()) ) {
          result[field] = result[field].id;
        }
      } 
    });
    return _.pick(result, filterFields);
  });
};


var _filterResults = function(results, filterFields) {

  return _.map(results, function(result){
    if(result.id == null) 
      result.id = result._id;

    return _.pick(result, filterFields); 
  });
};

var _filterResult = function(result, filterFields) {
  if(result.id == null) 
    result.id = result._id;
  return _.pick(result, filterFields); 
};


var _getCurrentFields = function(dotNotionFields) {
  return _.uniq(_.compact(_.map(dotNotionFields, function(field){
    var field = field.split('.');
    return field[0];
  })));
};


var _getChildFields = function(dotNotionFields, parentField) {
  return _.compact(_.map(dotNotionFields, function(field){
    var fields = field.split('.');
    if(fields[0] === parentField) {
      fields.shift();
      return fields.join('.');
    } else {
      return null;      
    }
  }));
};

//  Check if the model ref an array
var _isModelRefArray = function(schemaField) {
  return _.isObject(schemaField.caster);
};


var _getModelReferences = function (model) {

  var fields = model.schema.paths;

  return _.flatten(_.compact(_.map(_.pairs(fields), function(field) {
    //  If it's an array, get actual field attrs
    if(_isModelRefArray(field[1])) field = [field[0], field[1].caster];
    //  We don't want type mixed fields, or non Model Refs or _id
    if(_.isUndefined(field[1].instance) || field[1].instance !== 'ObjectID' || field[0] === '_id') return null;

    //  Check for special multiple model ref
    if(field[1].options.refs) {
      return _.map(field[1].options.refs, function(ref){
        return { field: field[0], model: ref }
      });
    }

    return { field: field[0], model: field[1].options.ref };
  })));
};



var _getFilterDepth = function(filterFields) {
  if(filterFields.length === 0) return 0;

  //  This is a hack, need to look at nicer way
  return 10;

  return _.max(filterFields, function(field){
    return field.split('.').length;
  }).split('.').length;
};



module.exports = exports = function mongooseExpandPlugin(schema, options) {

  schema.statics.findFP = findFP;
  schema.statics.findOneFP = findOneFP;
  schema.statics.findByIdAndUpdateFP = findByIdAndUpdateFP;
  schema.methods.saveFP = saveFP;

};

