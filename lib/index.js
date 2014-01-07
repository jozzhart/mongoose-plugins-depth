var mongoose = require('mongoose'),
    _ = require('underscore'),
    async = require('async');


var find = function (query, depth, fieldsFilter, cb) {

  if(_.isUndefined(this.schema.fieldsFilter)) return cb('Model ' + that.modelName + ' is missing a filter');

  // If fields filter is empty, use model default
  if(fieldsFilter.length === 0)
    fieldsFilter = this.schema.fieldsFilter;

  var schemaFields = this.schema.paths;

  var currentFields = _getCurrentFields(fieldsFilter);
  var modelRefFields = _getModelReferences(this);

  // Find the fields that need to be populated
  var populateFields = _.filter(modelRefFields, function(item){ return _.contains(currentFields, item.field) && item.field !== '_id'; });

  this.find(query).lean().exec(function(err, results) {
    if(results == null || results.length === 0) return cb(null);

    //  Our recursion check point
    if(depth > 0 && populateFields.length > 0) {
      _queryChildren(results, depth, fieldsFilter, populateFields, schemaFields, function(err, results){
        cb(err, _filterResults(results, currentFields));  
      });
    } else {
      cb(err, _filterResults(results, currentFields));  
    }
  });
};


var findOne = function (query, depth, fieldsFilter, cb) {

  if(_.isUndefined(this.schema.fieldsFilter)) return cb('Model ' + that.modelName + ' is missing a filter');

  // If fields filter is empty, use model default
  if(fieldsFilter.length === 0)
    fieldsFilter = this.schema.fieldsFilter;

  var schemaFields = this.schema.paths;

  var currentFields = _getCurrentFields(fieldsFilter);
  var modelRefFields = _getModelReferences(this);

  // Find the fields that need to be populated
  var populateFields = _.filter(modelRefFields, function(item){ return _.contains(currentFields, item.field) && item.field !== '_id'; });

  this.findOne(query).lean().exec(function(err, result) {
    if(results == null || results.length === 0) return cb(null);

    //  Our recursion check point
    if(depth > 0 && populateFields.length > 0) {
      _queryChildren(results, depth, fieldsFilter, populateFields, schemaFields, function(err, results){
        cb(err, _filterResult(result, currentFields));  
      });
    } else {
      cb(err, _filterResult(result, currentFields));  
    }
  });
};


var save = function(callback) {

  var filterFields = this.schema.fieldsFilter;

  this.save (function (err, instance) {
    if (err) return callback (err, null);
    var lean = instance.toObject();
    return callback (null, _filterResult(lean, filterFields));
  });
}



var _queryChildren = function(results, depth, fieldsFilter, populateFields, parentSchema, callback) {

  async.map(results, function(result, callback){
    async.each(populateFields, function(field, callback){
      if(_.isUndefined(mongoose.model(field.model).schema.fieldsFilter)) return callback('Model ' + field.model + ' is missing a filter');

      //  Get child fields of current Model field, and use default filter for Model if none defined
      var childFields = _getChildFields(fieldsFilter, field.field);
      if(childFields.length === 0) childFields = mongoose.model(field.model).schema.fieldsFilter;

      mongoose.model(field.model).filterPopulate().find({ _id : result[field.field] }, depth - 1, childFields, function(err, instances){

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

  schema.statics.filterPopulate = function(){
    return {
      find: find.bind(this),
      findOne: findOne.bind(this)
    }
  };

  schema.methods.filterPopulate = function(){
    return {
      save: save.bind(this)
    }
  };
};




