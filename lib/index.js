var mongoose = require('mongoose'),
    _ = require('underscore'),
    async = require('async');


var findExpand = function (query, depth, fieldsFilter, cb) {

  if(_.isUndefined(this.schema.fieldsFilter)) return cb('Model ' + this.modelName + ' is missing a filter');

  // If fields filter is empty, use model default
  if(fieldsFilter.length === 0)
    fieldsFilter = this.schema.fieldsFilter;

  var schemaFields = this.schema.paths;

  var currentFields = getCurrentFields(fieldsFilter);
  var modelRefFields = getModelReferences(this);
  var expandFields = _.filter(modelRefFields, function(item){ return _.contains(currentFields, item.field) && item.field !== '_id'; });

  this.find(query).lean().exec(function(err, results) {
    if(results == null || results.length === 0) return cb(null);

    //  Our recursion check point
    if(depth > 0 && expandFields.length > 0) {
      queryChildren(results, depth, fieldsFilter, expandFields, schemaFields, function(err, results){
        cb(err, filterResults(results, currentFields));  
      });
    } else {
      cb(err, filterResults(results, currentFields));  
    }
  });
};


var queryChildren = function(results, depth, fieldsFilter, expandFields, parentSchema, callback) {

  async.map(results, function(result, callback){
    async.each(expandFields, function(field, callback){
      if(_.isUndefined(mongoose.model(field.model).schema.fieldsFilter)) return callback('Model ' + field.model + ' is missing a filter');

      //  Get child fields of current Model field, and use default filter for Model if none defined
      var childFields = getChildFields(fieldsFilter, field.field);
      if(childFields.length === 0) childFields = mongoose.model(field.model).schema.fieldsFilter;

      mongoose.model(field.model).findExpand({ _id : result[field.field] }, depth - 1, childFields, function(err, instances){

        result[field.field] = _.map(instances, function(instance){ return _.pick(instance, childFields); });
        // If it is not an array, return single instance
        if(!isRefArray(parentSchema[field.field])) result[field.field] = result[field.field][0];

        callback(null);
      })
    }, function(err){
      callback(err, result)
    });
  }, function(err, results){
    callback(err, results);
  });
};

var filterResults = function(results, filterFields) {

  return _.map(results, function(result){
    if(result.id == null) 
      result.id = result._id;

    return _.pick(result, filterFields); 
  });
};


var getCurrentFields = function(dotNotionFields) {
  return _.uniq(_.compact(_.map(dotNotionFields, function(field){
    var field = field.split('.');
    return field[0];
  })));
};


var getChildFields = function(dotNotionFields, parentField) {

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


var isRefArray = function(schemaField) {
  return _.isObject(schemaField.caster);
};


var getModelReferences = function (model) {

  var fields = model.schema.paths;

  return _.compact(_.map(_.pairs(fields), function(field) {
    //  If it's an array, get actual field attrs
    if(isRefArray(field[1])) field = [field[0], field[1].caster];
    //  We don't want type mixed fields, or non Model Refs or _id
    if(_.isUndefined(field[1].instance) || field[1].instance !== 'ObjectID' || field[0] === '_id') return null;

    return { field: field[0], model: field[1].options.ref };
  }));
};

module.exports = exports = function mongooseExpandPlugin(schema, options) {
  schema.statics.findExpand = findExpand;
};




