var fs = require('fs')
  , path = require('path')
  , lconfig = require("lconfig")
  , spawn = require('child_process').spawn
  , IJOD = require('ijod').IJOD
  , async = require('async')
  , url = require('url')
  , lutil = require('lutil')
  , EventEmitter = require('events').EventEmitter
  , levents = require(__dirname + '/levents')
  , logger = require("./logger.js")
  , vm = require('vm')
  , util = require('util')
  , dispatcher = require('./instrument.js').StatsdDispatcher;

logger.verbose('Configured stats prefix is ' + lconfig.stats.prefix);
var stats = new dispatcher(lconfig.stats);

var runningContexts = {}; // Map of a synclet to a running context

function LockerInterface(synclet, info) {
  EventEmitter.call(this);
  this.synclet = synclet;
  this.info = info;
  this.srcdir = path.join(lconfig.lockerDir, info.srcdir);
  this.workingDirectory = path.join(lconfig.lockerDir, lconfig.me, info.id);
  this.processing = false; // If we're processing events
  this.events = [];
}
util.inherits(LockerInterface, EventEmitter);
LockerInterface.prototype.error = function(message) {
  logger.error("Error from synclet " + this.synclet.name + "/" + this.info.id + ": " + message);
};
// Fire an event from the synclet
LockerInterface.prototype.event = function(action, lockerType, obj) {
  this.events.push({action:action, lockerType:lockerType, obj:obj});
  this.emit("event");
  this.processEvents();
};
LockerInterface.prototype.processEvents = function() {
  if (this.processing) return;
  // Process the events we have
  this.processing = true;
  var self = this;
  var curEvents = this.events;
  this.events = [];
  async.forEachSeries(curEvents, function(event, cb) {
    processData([], self.info, self.synclet, event.lockerType, [event], cb);
  }, function(error) {
    self.processing = false;
    if (self.events.length === 0) {
      self.emit("drain");
    } else {
      process.nextTick(function() {
        self.processEvents();
      });
    }
  });
};
// Signals that the synclet context is complete and may be cleaned up
LockerInterface.prototype.end = function() {
  if (this.events.length > 0) {
    this.once("drain", function() {
      this.emit("end");
    });
  } else {
    this.emit("end");
  }
};

var synclets = {
    available:[],
    installed:{},
    ijods:{},
    executeable:true
};


// core syncmanager init function, need to talk to serviceManager
var serviceManager;
exports.init = function (sman, callback) {
    serviceManager = sman;
    callback();
};

var executeable = true;
exports.setExecuteable = function (e) {
    executeable = e;
};

exports.syncNow = function (serviceId, syncletId, post, callback) {
    if(typeof syncletId == "function")
    {
        callback = syncletId;
        syncletId = false;
    }
    var js = serviceManager.map(serviceId);
    if (!js || !js.synclets) return callback("no synclets like that installed");
    async.forEachSeries(js.synclets, function (synclet, cb) {
      if (!synclet) {
        logger.error("Unknown synclet info in syncNow");
        cb();
      }
        if(syncletId && synclet.name != syncletId) return cb();
        if(post)
        {
            if(!Array.isArray(synclet.posts)) synclet.posts = [];
            synclet.posts.push(post);
        }
        executeSynclet(js, synclet, cb, true);
    }, callback);
};

// run all synclets that have a tolerance and reset them
exports.flushTolerance = function(callback, force) {
    var map = serviceManager.map();
    async.forEach(Object.keys(map), function(service, cb){ // do all services in parallel
        if(!map[service].synclets) return cb();
        async.forEachSeries(map[service].synclets, function(synclet, cb2) { // do each synclet in series
            if (!force && (!synclet.tolAt || synclet.tolAt === 0)) return cb2();
            synclet.tolAt = 0;
            executeSynclet(map[service], synclet, cb2);
        }, cb);
    }, callback);
};

/**
* Add a timeout to run a synclet
*/
var scheduled = {};
exports.scheduleRun = function(info, synclet) {
    synclet.status = "waiting";
    if (!synclet.frequency) return;

    var key = info.id + "-" + synclet.name;
    logger.verbose("scheduling "+key);
    if(scheduled[key]) clearTimeout(scheduled[key]); // remove any existing timer

    // run from a clean state
    var force = false;
    function run() {
        delete scheduled[key];
        executeSynclet(info, synclet, function(){}, force);
    }

    // the synclet is paging and needs to run again immediately, forcefully
    if(info.config && info.config.nextRun === -1)
    {
        force = true;
        delete info.config.nextRun;
        logger.verbose("scheduling "+key+" to run immediately (paging)");
        return process.nextTick(run);
    }

    // validation check
    if(synclet.nextRun && typeof synclet.nextRun != "number") delete synclet.nextRun;

    // had a schedule and missed it, run it now
    if(synclet.nextRun && synclet.nextRun <= Date.now()) {
        logger.verbose("scheduling "+key+" to run immediately (missed)");
        return process.nextTick(run);
    }

    // if no schedule, in the future with 10% fuzz
    if(!synclet.nextRun)
    {
        var milliFreq = parseInt(synclet.frequency) * 1000;
        synclet.nextRun = parseInt(Date.now() + milliFreq + (((Math.random() - 0.5) * 0.5) * milliFreq)); // 50% fuzz added or subtracted
    }
    var timeout = synclet.nextRun - Date.now();
    logger.verbose("scheduling "+key+" (freq "+synclet.frequency+") to run in "+(timeout/1000)+"s");
    scheduled[key] = setTimeout(run, timeout);
};

function localError(base, err) {
    logger.error(base+"\t"+err);
}

/**
* Executes a synclet
*/
function executeSynclet(info, synclet, callback, force) {
    if(!callback) callback = function(err){
        if(err) return logger.error(err);
        logger.debug("finished processing "+synclet.name);
    };
    if (synclet.status === 'running') return callback('already running');
    delete synclet.nextRun; // cancel any schedule
    if(!info.auth || !info.authed) return callback("no auth info for "+info.id);
    // we're put on hold from running any for some reason, re-schedule them
    // this is a workaround for making synclets available in the map separate from scheduling them which could be done better
    if (!force && !executeable) {
        setTimeout(function() {
            executeSynclet(info, synclet, callback);
        }, 1000);
        return;
    }
    if(!synclet.tolMax) {
        synclet.tolAt = 0;
        synclet.tolMax = 0;
    }
    // if we can have tolerance, try again later
    if(!force && synclet.tolAt > 0) {
        synclet.tolAt--;
        logger.verbose("tolerance now at "+synclet.tolAt+" synclet "+synclet.name+" for "+info.id);
        exports.scheduleRun(info, synclet);
        return callback();
    }
    // if another synclet is running, come back a little later, don't overlap!
    if (info.status == 'running' || runningContexts[info.id + "/" + synclet.name]) {
        logger.verbose("delaying "+synclet.name);
        setTimeout(function() {
            executeSynclet(info, synclet, callback, force);
        }, 10000);
        return;
    }
    logger.info("Synclet "+synclet.name+" starting for "+info.id);
    info.status = synclet.status = "running";
    var tstart = Date.now();
    stats.increment('synclet.' + info.id + '.' + synclet.name + '.start');
    stats.increment('synclet.' + info.id + '.' + synclet.name + '.running');
    // This is super handy for testing.
    /*
    var fname = path.join("tmp", info.id + "-" + synclet.name + ".json");
    if (path.existsSync(fname)) {
      var resp = JSON.parse(fs.readFileSync(fname));
      var startTime = Date.now();
      console.log("Start response processing for %s", (info.id + "/" + synclet.name));
      processResponse({}, info, synclet, resp, function(processErr) {
        process.stdin.on("data", function(data) {
          console.log(data.toString());
        });
        console.log("Response Processing Done for %s in %d", (info.id + "/" + synclet.name), (Date.now() - startTime));
        info.status = 'waiting';
        callback(processErr);
      });
      return;
    }
    */

    if (info.vm || synclet.vm) {
      // Go ahead and create a context immediately so we get it listed as
      // running and dont' start mulitple ones
      var sandbox = {
        // XXX: This could be a problem later and need a cacheing layer to
        // remove anything that they add, but for now we'll allow it
        // direct and see the impact
        require:require,
        console:console,
        exports:{}
      };
      var context = vm.createContext(sandbox);
      runningContexts[info.id + "/" + synclet.name] = context;
      // Let's get the code loaded
      var fname = path.join(info.srcdir, synclet.name + ".js");
      fs.readFile(fname, function(err, code) {
        if (err) {
          logger.error("Unable to load synclet " + synclet.name + "/" + info.id + ": " + err);
          return callback(err);
        }
        try {
          synclet.deleted = synclet.added = synclet.updated = 0;
          vm.runInContext(code, context, fname);

          if (!info.config) info.config = {};

          if (!info.absoluteSrcdir) info.absoluteSrcdir = path.join(lconfig.lockerDir, info.srcdir);
          if (!info.workingDirectory) info.workingDirectory = path.join(lconfig.lockerDir, lconfig.me, info.id);
          synclet.workingDirectory = info.workingDirectory; // legacy?
          info.syncletToRun = synclet;
          info.lockerUrl = lconfig.lockerBase;
          sandbox.exports.sync(info, function(syncErr, response) {
            delete runningContexts[info.id + "/" + synclet.name];
            if (syncErr) {
              logger.error(synclet.name+" error: "+util.inspect(syncErr));
              info.status = synclet.status = 'failed';
              return callback(syncErr);
            }
            var elapsed = Date.now() - tstart;
            stats.increment('synclet.' + info.id + '.' + synclet.name + '.stop');
            stats.decrement('synclet.' + info.id + '.' + synclet.name + '.running');
            stats.timing('synclet.' + info.id + '.' + synclet.name + '.timing', elapsed);
            logger.info("Synclet "+synclet.name+" finished for "+info.id+" timing "+elapsed);
            info.status = synclet.status = 'processing data';
            var deleteIDs = compareIDs(info.config, response.config);
            info.auth = lutil.extend(true, info.auth, response.auth); // for refresh tokens and profiles
            info.config = lutil.extend(true, info.config, response.config);
            exports.scheduleRun(info, synclet);
            serviceManager.mapDirty(info.id); // save out to disk
            processResponse(deleteIDs, info, synclet, response, function(processErr) {
                info.status = 'waiting';
                callback(processErr);
            });
          });
        } catch (E) {
          logger.error("Error running " + synclet.name + "/" + info.id + " in a vm context: " + E);
          return callback(E);
        }
      });
      if(synclet.posts) synclet.posts = []; // they're serialized, empty the queue
      delete info.syncletToRun;
      return;
    }
    var run;
    var env = process.env;
    if (!synclet.run) {
        env["NODE_PATH"] = path.join(lconfig.lockerDir, 'Common', 'node') + ":" + path.join(lconfig.lockerDir, "node_modules");
        run = ["node", lconfig.lockerDir + "/Common/node/synclet/client.js"];
    } else if (synclet.run.substr(-3) == ".py") {
        env["PYTHONPATH"] = path.join(lconfig.lockerDir, 'Common', 'python');
        run = ["python", lconfig.lockerDir + "/Common/python/synclet/client.py"];
    } else {
        env["NODE_PATH"] = path.join(lconfig.lockerDir, 'Common', 'node') + ":" + path.join(lconfig.lockerDir, "node_modules");
        run = ["node", path.join(lconfig.lockerDir, info.srcdir, synclet.run)];
    }

    var dataResponse = '';
    var cwd = (info.srcdir.charAt(0) == '/') ? info.srcdir : path.join(lconfig.lockerDir, info.srcdir);
    var app = spawn(run.shift(), run, {cwd: cwd, env:env});

    // edge case backup, max 30 min runtime by default
    var timer = setTimeout(function(){
        logger.error("Having to kill long-running "+synclet.name+" synclet of "+info.id);
        info.status = synclet.status = 'failed : timeout';
        process.kill(app.pid); // will fire exit event below and cleanup
    }, (synclet.timeout) ? synclet.timeout : 30*60*1000);

    app.stderr.on('data', function (data) {
        localError(info.title+" "+synclet.name + " error:",data.toString());
    });

    app.stdout.on('data',function (data) {
        dataResponse += data;
    });

    app.on('exit', function (code,signal) {
        clearTimeout(timer);
        var response;
        try {
            response = JSON.parse(dataResponse);
        } catch (E) {
            if (info.status != 'failed : timeout') {
                localError("Service : " + info.title + ", synclet: "+synclet.name, ". Failed to parse the response from the synclet.  Error was: '" + E + "' and the response from the synclet was '" + dataResponse + "'");
                info.status = synclet.status = 'failed : ' + E;
            }
            if (callback) callback(E);
            return;
        }
        var elapsed = Date.now() - tstart;
        stats.increment('synclet.' + info.id + '.' + synclet.name + '.stop');
        stats.decrement('synclet.' + info.id + '.' + synclet.name + '.running');
        stats.timing('synclet.' + info.id + '.' + synclet.name + '.timing', elapsed);
        logger.info("Synclet "+synclet.name+" finished for "+info.id+" timing "+elapsed);
        info.status = synclet.status = 'processing data';
        var deleteIDs = compareIDs(info.config, response.config);
        info.auth = lutil.extend(true, info.auth, response.auth); // for refresh tokens and profiles
        info.config = lutil.extend(true, info.config, response.config);
        exports.scheduleRun(info, synclet);
        serviceManager.mapDirty(info.id); // save out to disk
        processResponse(deleteIDs, info, synclet, response, function(err){
            info.status = 'waiting';
            callback(err);
        });
    });
    if (!info.config) info.config = {};

    info.syncletToRun = synclet;
    info.syncletToRun.workingDirectory = path.join(lconfig.lockerDir, lconfig.me, info.id);
    info.lockerUrl = lconfig.lockerBase;
    app.stdin.on('error',function(err){
        localError(info.title+" "+synclet.name, "stdin closed: "+err);
    });
    app.stdin.write(JSON.stringify(info)+"\n"); // Send them the process information
    if(synclet.posts) synclet.posts = []; // they're serialized, empty the queue
    delete info.syncletToRun;
}

function compareIDs (originalConfig, newConfig) {
    var resp = {};
    if (originalConfig && originalConfig.ids && newConfig && newConfig.ids) {
        for (var i in newConfig.ids) {
            if (!originalConfig.ids[i]) break;
            var newSet = newConfig.ids[i];
            var oldSet = originalConfig.ids[i];
            var seenIDs = {};
            resp[i] = [];
            for (var j = 0; j < newSet.length; j++) seenIDs[newSet[j]] = true;
            for (var j = 0; j < oldSet.length; j++) {
                if (!seenIDs[oldSet[j]]) resp[i].push(oldSet[j]);
            }
        }
    }
    return resp;
}

function processResponse(deleteIDs, info, synclet, response, callback) {
    synclet.status = 'waiting';

    var dataKeys = [];
    if (typeof(response.data) === 'string') {
        return callback('bad data from synclet');
    }
    for (var i in response.data) {
        if(!Array.isArray(response.data[i])) continue;
        dataKeys.push(i);
    }
    for (var i in deleteIDs) {
        if (!dataKeys[i]) dataKeys.push(i);
    }
    synclet.deleted = synclet.added = synclet.updated = 0;
    async.forEach(dataKeys, function(key, cb) { processData(deleteIDs[key], info, synclet, key, response.data[key], cb); }, function(err){
        if(err) logger.error("err processing data: "+err);
        // here we roughly compromise a multiplier up or down based on the threshold being met
        var threshold = synclet.threshold || lconfig.tolerance.threshold;
        var total = synclet.deleted + synclet.added + synclet.updated;
        if(total < threshold)
        {
            if(synclet.tolMax < lconfig.tolerance.maxstep) synclet.tolMax++; // max 10x scheduled
            synclet.tolAt = synclet.tolMax;
        }else{
            if(synclet.tolMax > 0) synclet.tolMax--;
            synclet.tolAt = synclet.tolMax;
        }
        logger.info("total of "+synclet.added+"+"+synclet.updated+"+"+synclet.deleted+" and threshold "+threshold+" so setting tolerance to "+synclet.tolMax);
        callback(err);
    });
}

// simple async friendly wrapper
function getIJOD(id, key, create, callback) {
    var name = path.join(lconfig.lockerDir, lconfig.me, id, key);
    if(synclets.ijods[name]) return callback(synclets.ijods[name]);
    // only load if one exists or create flag is set
    fs.stat(name+".db", function(err, stat){
        if(!stat && !create) return callback();
        synclets.ijods[name] = new IJOD({name:name}, function(err, ij){
            if(err) logger.error(err);
            return callback(ij);
        });
    });
}

exports.getIJOD = getIJOD;

function processData (deleteIDs, info, synclet, key, data, callback) {
    // this extra (handy) log breaks the synclet tests somehow??
    var len = (data)?data.length:0;
    var type = (info.types && info.types[key]) ? info.types[key] : key; // try to map the key to a generic data type for the idr
    var idr = lutil.idrNew(type, info.provider, undefined, key, info.id);
    if(len > 0) logger.info("processing synclet data from "+idr+" of length "+len);
    var collection = info.id + "_" + key;

    if (key.indexOf('/') !== -1) {
        console.error("DEPRECATED, dropping! "+key);
        return callback();
    }

    var mongoId;
    if (typeof info.mongoId === 'string') mongoId = info.mongoId;
    else if (info.mongoId) mongoId = info.mongoId[key + 's'] || info.mongoId[key] || 'id';
    else mongoId = 'id';

    getIJOD(info.id, key, true, function(ij){
        if (deleteIDs && deleteIDs.length > 0 && data) {
            addData(collection, mongoId, data, info, synclet, idr, ij, function(err) {
                if(err) {
                    callback(err);
                } else {
                    deleteData(collection, mongoId, deleteIDs, info, synclet, idr, ij, callback);
                }
            });
        } else if (data && data.length > 0) {
          addData(collection, mongoId, data, info, synclet, idr, ij, function(err) {
            callback();
          });
        } else if (deleteIDs && deleteIDs.length > 0) {
            deleteData(collection, mongoId, deleteIDs, info, synclet, idr, ij, callback);
        } else {
            callback();
        }
    });
}

function deleteData (collection, mongoId, deleteIds, info, synclet, idr, ij, callback) {
    var q = async.queue(function(id, cb) {
        var r = url.parse(idr);
        r.hash = id.toString();
        levents.fireEvent(url.format(r), 'delete');
        synclet.deleted++;
        ij.delData({id:id}, cb);
    }, 5);
    // debug stuff
    var oldProcess = q.process;
    q.process = function() {
      var task = q.tasks[0];
      try {
        oldProcess();
      } catch (err) {
        console.error('ERROR: caught error while processing q on task ', task);
      }
    };
    deleteIds.forEach(q.push);
    q.drain = callback;
}

function addData (collection, mongoId, data, info, synclet, idr, ij, callback) {
  var errs = [];
  // Take out the deletes
  var deletes = data.filter(function(item) {
    var object = (item.obj) ? item : {obj: item};
    if (object.obj && object.type === "delete") {
      return true;
    }
    return false;
  });
  // TODO The deletes
  async.forEachSeries(deletes, function(item, cb) {
    var r = url.parse(idr);
    r.hash = object.obj[mongoId].toString();
    levents.fireEvent(url.format(r), 'delete');
    synclet.deleted++;
    ij.delData({id:object.obj[mongoId]}, cb);
  }, function(err) {
    // Now we'll batch process the rest as adds
    var entries = data.filter(function(item) {
      var object = (item.obj) ? item : {obj: item};
      if (object.obj && object.type === "delete") {
        return false;
      }
      return true; 
    });
    entries = entries.map(function(item) { 
      var object = (item.obj) ? item : {obj: item};
      return {id:object.obj[mongoId], data:object.obj};
    });
    ij.batchSmartAdd(entries, function() {
      // TODO:  Return some stats from batch add for added and updated
      entries.forEach(function(item) {
        var r = url.parse(idr);
        r.hash = item.toString();
        levents.fireEvent(url.format(r), "new", item.data);
      });
      callback();
    });
  });
}


