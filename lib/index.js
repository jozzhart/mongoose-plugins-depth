var mongoose = require('mongoose'),
    _ = require('underscore'),
    async = require('async');


var options = {
  depth: 2,
  filterFields: []
};

  
var findFP = function (query, opts, cb) {

  var opts = _.defaults(opts, options);

  if(_.isUndefined(this.schema.filterFields)) return cb('Model ' + that.modelName + ' is missing a filter');

  // If fields filter is empty, use model default
  if(opts.filterFields.length === 0)
    opts.filterFields = this.schema.filterFields;

  var schemaFields = this.schema.paths;
  var currentFields = _getCurrentFields(opts.filterFields);
  var modelRefFields = _getModelReferences(this);

  // Find the fields that need to be populated
  var populateFields = _.filter(modelRefFields, function(item){ return _.contains(currentFields, item.field) && item.field !== '_id'; });

  this.find(query).lean().exec(function(err, results) {
    if(results == null || results.length === 0) return cb(null);

    //  Our recursion check point
    if(opts.depth > 0 && populateFields.length > 0) {
      _queryChildren(results, opts.depth, opts.filterFields, populateFields, schemaFields, function(err, results){
        cb(err, _filterResults(results, currentFields));  
      });
    } else {
      cb(err, _filterResults(results, currentFields));  
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


var _queryChildren = function(results, depth, filterFields, populateFields, parentSchema, callback) {

  async.map(results, function(result, callback){
    async.each(populateFields, function(field, callback){
      if(_.isUndefined(mongoose.model(field.model).schema.filterFields)) return callback('Model ' + field.model + ' is missing a filter');

      //  Get child fields of current Model field, and use default filter for Model if none defined
      var childFields = _getChildFields(filterFields, field.field);
      if(childFields.length === 0) childFields = mongoose.model(field.model).schema.filterFields;

      var options = {
        depth: depth - 1,
        filterFields: childFields
      };

      mongoose.model(field.model).findFP({ _id : result[field.field] }, options, function(err, instances){
        if(err) return callback(err);

        result[field.field] = _.map(instances, function(instance){ return _.pick(instance, childFields); });
        // If it is not an array, return single instance
        if(!_isModelRefArray(parentSchema[field.field])) result[field.field] = result[field.field][0];

        callback(null);
      })
    }, function(err){
      callback(err, result)
    });
  }, function(err, results){
    callback(err, results);
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

  return _.compact(_.map(_.pairs(fields), function(field) {
    //  If it's an array, get actual field attrs
    if(_isModelRefArray(field[1])) field = [field[0], field[1].caster];
    //  We don't want type mixed fields, or non Model Refs or _id
    if(_.isUndefined(field[1].instance) || field[1].instance !== 'ObjectID' || field[0] === '_id') return null;

    return { field: field[0], model: field[1].options.ref };
  }));
};


module.exports = exports = function mongooseExpandPlugin(schema, options) {

  schema.statics.findFP = findFP;
  schema.statics.findOneFP = findOneFP;
  schema.statics.findByIdAndUpdateFP = findByIdAndUpdateFP;
  schema.methods.saveFP = saveFP;

};

