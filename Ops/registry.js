/*
*
* Copyright (C) 2011, The Locker Project
* All rights reserved.
*
* Please see the LICENSE file for more information.
*
*/

// all of the registry-related interactions

var npm = require('npm');
var fs = require('fs');
var path = require('path');
var async = require('async');
var request = require('request');
var semver = require('semver');
var crypto = require("crypto");
var lutil = require('lutil');
var express = require('express');
var querystring = require('querystring');
var logger;
var lconfig;
var lcrypto;
var regIndex = {};
var syncInterval = 3600000;
var syncTimer;
var regBase = 'http://registry.singly.com';
var burrowBase = "burrow.singly.com";
var serviceManager, syncManager;
var apiKeys;

// make sure stuff is ready/setup locally, load registry, start sync check, etc
exports.init = function(serman, syncman, config, crypto, callback) {
    serviceManager = serman;
    syncManager = syncman;
    lconfig = config;
    apiKeys = JSON.parse(fs.readFileSync(lconfig.lockerDir + "/Config/apikeys.json", 'utf-8'));
    logger = require('logger');
    lcrypto = crypto;
    try {
        fs.mkdirSync(path.join(lconfig.lockerDir, lconfig.me, "node_modules"), 0755); // ensure a home in the Me space
    } catch(E) {}
    var home = path.join(lconfig.lockerDir, lconfig.me);
    process.chdir(home);
    var config = {registry:regBase, cache:path.join(home, '.npm')};
    npm.load(config, function(err) {
        if(err) logger.error(err);
        fs.readFile('registry.json', 'utf8', function(err, reg){
            try {
                if(reg) regIndex = JSON.parse(reg);
            }catch(E){
                logger.error("couldn't parse registry.json: "+E);
            }
            if(lconfig.registryUpdate === true) {
                exports.sync();
            }
            process.chdir(lconfig.lockerDir);
            callback();
        });
    });
};

// init web endpoints
exports.app = function(app)
{
    app.get('/registry/add/:id', function(req, res) {
        logger.info("registry trying to add "+req.params.id);
        if(!regIndex[req.params.id]) return res.send("not found", 404);
        if(!verify(regIndex[req.params.id])) return res.send("invalid package", 500);
        exports.install({name:req.params.id}, function(err){
            if(err) return res.send(err, 500);
            res.send(true);
        });
    });
    app.get('/registry/apps', function(req, res) {
        res.send(exports.getApps());
    });
    app.get("/registry/connectors", function(req, res) {
        var connectors = [];
        Object.keys(regIndex).forEach(function(key) {
            if (regIndex[key].repository && regIndex[key].repository && regIndex[key].repository.type == "connector") {
                // not all connectors need auth keys!
                if(regIndex[key].repository.keys === false || regIndex[key].repository.keys == "false") connectors.push(regIndex[key]);
                // require keys now
                if(apiKeys[key]) connectors.push(regIndex[key]);
            }
        });
        // TODO: STREAM!
        res.send(connectors);
    });
    app.get('/registry/all', function(req, res) {
        res.send(exports.getRegistry());
    });
    app.get('/registry/app/:id', function(req, res) {
        var id = req.params.id;
        if(!regIndex[id]) return res.send("not found", 404);
        var copy = lutil.extend(true, {}, regIndex[id]);
        copy.installed = (serviceManager.map(k)) ? true : false;
        res.send(copy);
    });
    app.get('/registry/sync', function(req, res) {
        logger.info("manual registry sync");
        exports.sync(function(err){
            if(err) return res.send(500, err);
            res.send(true);
        }, req.param('force'));
    });
    // takes the local github id format, user-repo
    app.get('/registry/publish/:id', publishPackage);

    app.post('/registry/publish/:id', express.bodyParser(), publishPackage);

    app.put("/registry/screenshot/:id", publishScreenshot);
    app.get("/registry/screenshot/:id", getScreenshot);

    app.get('/registry/myApps', exports.getMyApps);

    app.get('/auth/:id', authIsAwesome);
    app.get('/auth/:id/auth', authIsAuth);
}

function publishPackage(req, res) {
    logger.info("registry publishing "+req.params.id);
    var id = req.params.id;
    if(id.indexOf("-") <= 0) return res.send("not found", 404);
    if(id.indexOf("..") >= 0 || id.indexOf("/") >= 0) return res.send("invalid id characters", 500)
    id = id.replace("-","/");
    var dir = path.join(lconfig.lockerDir, lconfig.me, 'github', id);
    fs.stat(dir, function(err, stat){
        if(err || !stat || !stat.isDirectory()) return res.send("invalid id", 500);
        var args = req.query || {};
        args.dir = dir;
        if (req.body) {
            args.body = req.body;
        }
        exports.publish(args, function(err, doc){
            // npm publish always returns an error even though it works, so until that's fixed, commenting this out
            //if(err) res.send(err, 500);
            res.send(doc);
        });
    });
}

function publishScreenshot(req, res) {
    // TODO: This should really use streams, but it's not letting us.
    var buffer = new Buffer(Number(req.headers["content-length"]), "binary");
    var offset = 0;
    req.on("data", function(data) {
        data.copy(buffer, offset, 0, data.length);
        offset += data.length;
    });
    req.on("end", function() {
        // first, required github
        regUser(function(err, auth){
            if(err ||!auth || !auth._auth) {
                res.send(err, 400);
                return;
            }
            logger.log("info", "Publising the screenshot for " + req.params.id);
            request.get({uri:"https://" + burrowBase + "/registry/" + req.params.id, json:true}, function(err, result, body) {
                if (err) {
                    logger.log("error", "Tried to publish a screenshot to nonexistent package " + req.params.id);
                    res.send(err, 400);
                    return;
                }
                var putReq = request.put(
                    {
                        url:"https://" + burrowBase + "/registry/" + req.params.id + "/screenshot.png?rev=" + body._rev ,
                        headers:{"Content-Type":"image/png", Authorization:"Basic " + auth._auth, "Content-Length":req.headers["content-length"]},
                        body:buffer
                    },
                    function(putErr, putResult, putBody) {
                        if (putErr) {
                            logger.log("error", "Error uploading the screenshot: " + putErr);
                            return res.send(err, 400);
                        }
                        logger.info("Registry done sending screenshot");
                        res.send(200);
                    }
                );
                //req.pipe(putReq);
                /*
                putReq.on("error", function(err) {
                    res.send(400, err);
                });
                putReq.on("end", function() {
                    res.send(200);
                });
                putReq.on("data", function(data) {
                    console.log("registry: " + data);
                });
                req.on("data", function() {
                    console.log("read some data for the registry");
                });
                */
            });
        })
    });
}

function getScreenshot(req, res) {
    if (!regIndex[req.params.id])
        res.redirect("/Me/dashboardv3/img/batman.jpg");
    else
        res.redirect("https://" + burrowBase + "/registry/" + req.params.id + "/screenshot.png");
}

// verify the validity of a package
function verify(pkg)
{
    if(!pkg) return false;
    if(lconfig.requireSigned && !pkg.signed) return false;
    if(!pkg.repository) return false;
    if(pkg.repository.type == 'app') return true;
    if(pkg.repository.type == 'connector') return true;
    if(pkg.repository.type == 'collection') return true;
    return false;
}

// background sync process to fetch/maintain the full package list
exports.sync = function(callback, force)
{
    function finish(err) {
        if (lconfig.registryUpdate) {
            syncTimer = setTimeout(exports.sync, syncInterval);
        }
        if (callback) callback(err);
    }

    if (syncTimer) clearTimeout(syncTimer);
    // always good to refresh this too!
    apiKeys = JSON.parse(fs.readFileSync(lconfig.lockerDir + "/Config/apikeys.json", 'utf-8'));

    var startkey = 0;
    // get the newest
    Object.keys(regIndex).forEach(function(k){
        if(!regIndex[k].time || !regIndex[k].time.modified) return;
        var mod = new Date(regIndex[k].time.modified).getTime();
        if(mod > startkey) startkey = mod;
    });
    // look for updated packages newer than the last we've seen
    startkey++;
    if(force) startkey = 0; // refresh fully
    var u = regBase+'/-/all/since?stale=update_after&startkey='+startkey;
    logger.info("registry update from "+u);
    request.get({uri:u, json:true}, function(err, resp, body){
        if(err || !body || typeof body !== "object" || body === null || Object.keys(body).length === 0) return callback ? callback() : "";
        // replace in-mem representation
        if(force) regIndex = {}; // cleanse!
        // new updates from the registry, update our local mirror
        async.forEachSeries(Object.keys(body), function(pkg, cb){
            if(!body[pkg].versions) return cb();
            checkPkg(body[pkg], Object.keys(body[pkg].versions).sort(semver.compare), cb);
        }, function(){
            // cache to disk lazily
            lutil.atomicWriteFileSync(path.join(lconfig.lockerDir, lconfig.me, 'registry.json'), JSON.stringify(regIndex));
            finish();
        });

    });
};

// recursively process vers array, looking for one that is signed, then process that
function checkPkg(pkg, versions, callback)
{
    if(!versions || versions.length == 0) return callback();
    if(!lconfig.requireSigned) return usePkg(pkg, pkg["dist-tags"].latest, callback); // if no sig required just pass through
    var ver = versions.pop(); // try newest
    var url = "https://" + burrowBase + "/registry/" + pkg.name + "/signature-"+ver;
    request.get({uri:url}, function(err, resp, body){
        if(err || !body || !body.sig) return checkPkg(pkg, versions, callback);
        // annoyingly, /-/all is different structure than /packagename!
        var data = (pkg.dist) ? pkg.dist[ver].shasum + " " + pkg.dist[ver].tarball : pkg.versions[ver].dist.shasum + " " + pkg.versions[ver].dist.tarball;
        if(!crypto.verify(data, body.sig, lconfig.keys)) {
            logger.error(pkg.name + " version "+ ver+ " signature failed verification :(");
            return checkPkg(pkg, versions, callback);
        }
        pkg.signed = true;
        return usePkg(pkg, ver, callback);
    });
}

// good version, update!
function usePkg(pkg, ver, callback)
{
    logger.verbose("new "+pkg.name+" "+ver);
    pkg.latest = ver;
    regIndex[pkg.name] = pkg;
    if(serviceManager.map(pkg.name) && pkg.repository && (pkg.repository.update == 'auto' || pkg.repository.update == 'true' || pkg.repository.update === true) && semver.lt(serviceManager.map(pkg.name).version, ver))
    {
        logger.verbose("auto-updating "+pkg.name);
        exports.install({name:pkg.name}, function(){}); // lazy update
    }
    callback();
}

exports.getRegistry = function() {
    return regIndex;
}
exports.getPackage = function(name) {
    return regIndex[name];
}
exports.getApps = function() {
    var apps = {};
    Object.keys(regIndex).forEach(function(k){
        if(!regIndex[k].repository || regIndex[k].repository.type != 'app') return;
        apps[k] = regIndex[k];
        apps[k].installed = (serviceManager.map(k)) ? true : false;
    });
    return apps;
}
exports.getMyApps = function(req, res) {
    github(function(gh) {
        var apps = {};
        if (gh && gh.login) {
            Object.keys(regIndex).forEach(function(k){
                var thiz = regIndex[k];
                if(thiz.repository && thiz.repository.type === 'app' && thiz.name && thiz.name.indexOf(gh.login + '-') >= 0) {
                    apps[k] = thiz;
                }
            });
        }
        res.send(apps);
    });
}

// npm wrappers
exports.install = function(arg, callback) {
    if(typeof arg === 'string') arg = {name:arg}; // convenience
    if(!arg || !arg.name) return callback("missing package name");
    var npmarg = [];
    if(serviceManager.map(arg.name)) return callback(null, serviceManager.map(arg.name)); // in the map already

    // if not in registry yet, try to go get it directly!
    var reg = regIndex[arg.name];
    if(!reg || !reg.latest) {
        request.get({uri:regBase+'/'+arg.name, json:true}, function(err, resp, body){
            if(err || !body || !body.versions) return callback("can't find in the registry");
            checkPkg(body, Object.keys(body.versions).sort(semver.compare), function(){
                if(!regIndex[arg.name] || !regIndex[arg.name].latest) return callback("failed to find valid version");
                return exports.install(arg, callback); // saved now, re-run
            });
        });
        return;
    }
    var npmarg = [arg.name+'@'+reg.latest];
    logger.info("installing "+JSON.stringify(npmarg));
    npm.commands.install(npmarg, function(err){
        if(err){ // some errors appear to be transient
            if(!arg.retry) arg.retry=0;
            arg.retry++;
            logger.warn("retry "+arg.retry+": "+err);
            if(arg.retry < 3) return setTimeout(function(){exports.install(arg, callback);}, 1000);
            return callback(err);
        }
        var ppath = path.join(lconfig.me, 'node_modules', arg.name, 'package.json');
        var up = serviceManager.mapUpsert(ppath);
        if(!up) callback("upsert failed");
        callback(null, up);
    });
};

// takes a dir, and publishes it as a package, initializing if needed
exports.publish = function(arg, callback) {
    if(!arg || !arg.dir) return callback("missing base dir");
    var pjs = path.join(arg.dir, "package.json");
    logger.info("publishing "+pjs);
    // first, required github
    github(function(gh){
        if(!gh) return callback("github account is required");
        // next, required registry auth
        regUser(function(err, auth){
            if(err ||!auth || !auth._auth) return callback(err);
            // saves for publish auth and maintainer
            npm.config.set("username", auth.username);
            npm.config.set("email", auth.email);
            npm.config.set("_auth", auth._auth);
            // make sure there's a package.json
            checkPackage(pjs, arg, gh, function(){
                // bump version
                process.chdir(arg.dir); // this must be run in the package dir, grr
                npm.commands.version(["patch"], function(err){
                    process.chdir(lconfig.lockerDir); // restore
                    if(err) return callback(err);
                    // finally !!!
                    npm.commands.publish([arg.dir], function(err){
                        if(err) return callback(err);
                        var updated = JSON.parse(fs.readFileSync(pjs));
                        regIndex[updated.name] = updated; // shim it in, sync will replace it eventually too just to be sure
                        var issues = require(path.join(lconfig.lockerDir, lconfig.me, "github/issue.js")); // this feels dirty, but is also reusing the synclet pattern
                        issues.sync(serviceManager.map('github'), function(err, js){
                            if(err) return callback(err);
                            if(!js || !js.data || !js.data.issue || !js.data.issue[0]) return callback("missing issue");
                            callback(null, updated, js.data.issue[0]);
                        });
                    })
                });
            });
        });
    })
};

// make sure a package.json exists, or create one
function checkPackage(pjs, arg, gh, callback)
{
    fs.stat(pjs, function(err, stat){
        var js = {};
        if(err || !stat || !stat.isFile())
        {
            var pkg = path.basename(path.dirname(pjs));
            var handle = ("app-" + gh.login + "-" + pkg).toLowerCase();
            var js = {
              "author": { "name": gh.login },
              "name": handle,
              "description": arg.description || "",
              "version": "0.0.0",
              "repository": {
                "title": arg.title || pkg,
                "handle": handle,
                "type": "app",
                "author": gh.login,
                "static": true,
                "update": true,
                "github": "https://github.com/"+gh.login+"/"+pkg
              },
              "dependencies": {},
              "devDependencies": {},
              "engines": {"node": "*"}
            };
        } else {
            js = JSON.parse(fs.readFileSync(pjs));
        }
        if (arg.body) {
            if (arg.body.title) {
                js.repository.title = arg.body.title;
            }
            if (arg.body.desc) {
                js.description = arg.body.desc;
            }
            if (arg.body.uses) {
                js.repository.uses = arg.body.uses;
            }
        }
        lutil.atomicWriteFileSync(pjs, JSON.stringify(js));
        return callback();
    });
}

var user;
function getUser() {
    if(user && user.username && user.email && user.pw) return user;
    return user = {
        username: lcrypto.encrypt('username'), // we just need something locally regenerable
        email: lcrypto.encrypt('email') + '@singly.com', // we just need something locally regenerable
        pw: lcrypto.encrypt('password'), // we just need something locally regenerable
    }
}

// return authenticated user, or create/init them
function regUser(callback)
{
    fs.readFile(path.join(lconfig.lockerDir, lconfig.me, 'registry_auth.json'), 'utf8', function(err, auth){
        var js;
        try { js = JSON.parse(auth); }catch(E){}
        if(js) return callback(false, js);
        var user = getUser();
        // try creating this user on the registry
        adduser(user.username, user.pw, user.email, function(err, resp, body){
            // TODO, is 200 and 409 both valid?
            if(err) logger.error(err);
            //logger.error(resp);
            js = {_auth:(new Buffer(user.username+":"+user.pw,"ascii").toString("base64")), username:user.username, email:user.email};
            lutil.atomicWriteFileSync(path.join(lconfig.lockerDir, lconfig.me, 'registry_auth.json'), JSON.stringify(js));
            callback(false, js);
        });
    });
}

// fetch and cache the connected github account profile
var ghprofile;
function github(callback)
{
    if(ghprofile) return callback(ghprofile);
    request.get({uri:lconfig.lockerBase+'/Me/github/getCurrent/profile', json:true}, function(err, resp, body){
        if(err || !body || body.length != 1 || !body[0].login) return callback();
        ghprofile = body[0];
        callback(ghprofile);
    });
}

// copied and modified from npm/lib/utils/registry/adduser.js
function adduser (username, password, email, cb) {
  if (password.indexOf(":") !== -1) return cb(new Error(
    "Sorry, ':' chars are not allowed in passwords.\n"+
    "See <https://issues.apache.org/jira/browse/COUCHDB-969> for why."))
  var salt = "na"
    , userobj =
      { name : username
      , salt : salt
      , password_sha : crypto.createHash("sha1").update(password+salt).digest("hex")
      , email : email
      , _id : 'org.couchdb.user:'+username
      , type : "user"
      , roles : []
      , date: new Date().toISOString()
      }
      logger.info("adding user "+JSON.stringify(userobj));
  request.put({uri:regBase+'/-/user/org.couchdb.user:'+encodeURIComponent(username), json:true, body:userobj}, cb);
}

// given a connector package in the registry, install it, and get the auth url for it to return
function authIsAwesome(req, res) {
    var id = req.params.id;
    if(!verify(regIndex[id]))
    {
        logger.error("package verification failed trying to auth "+id);
        return res.send(id+" failed verification :(", 500);
    }
    exports.install(id, function(err){
        if(err) return res.send(err, 500);
        var js = serviceManager.map(id);
        if(!js) return res.send("failed to install :(", 500);
        try {
            var authModule = require(path.join(lconfig.lockerDir, js.srcdir, 'auth.js'));
        }catch(E){
            return res.send(E, 500);
        }
        // oauth2 types redirect
        if(authModule.authUrl) {
            var url = authModule.authUrl + "&client_id=" + apiKeys[id].appKey + "&redirect_uri=" + lconfig.externalBase + "/auth/" + id + "/auth";
            return res.redirect(url);
        }
        // everything else is pass-through (custom, oauth1, etc)
        authIsAuth(req, res);
    });
}

// handle actual auth api requests or callbacks, much conflation to keep /auth/foo/auth consistent everywhere!
function authIsAuth(req, res) {
    var id = req.params.id;
    logger.verbose("processing auth for "+id);
    var js = serviceManager.map(id);
    if(!js) return res.send("missing", 404);
    var host = lconfig.externalBase + "/";
    try {
        var authModule = require(path.join(lconfig.lockerDir, js.srcdir, 'auth.js'));
    }catch(E){
        return res.send(E, 500);
    }

    // some custom code gets run for non-oauth2 options here, wear a tryondom
    try {
        if(authModule.direct) return authModule.direct(res);
        // rest require apikeys
        if(!apiKeys[id] && js.keys !== false && js.keys != "false") return res.send("missing required api keys", 500);
        if(typeof authModule.handler == 'function') return authModule.handler(host, apiKeys[id], function(err, auth) {
            if(err) return res.send(err, 500);
            finishAuth(js, auth, res);
        }, req, res);
    } catch(E) {
        return res.send(E, 500);
    }

    // oauth2 callbacks from here on out
    var code = req.param('code');
    var theseKeys = apiKeys[id];
    if(!code || !authModule.handler.oauth2) return res.send("very bad request", 500);
    var method = authModule.handler.oauth2;
    var postData = {
        client_id: theseKeys.appKey,
        client_secret: theseKeys.appSecret,
        redirect_uri: host + 'auth/' + id + '/auth',
        grant_type: authModule.grantType,
        code: code
    };
    var req = {method: method, url: authModule.endPoint};
    if(method == 'POST') {
        req.body = querystring.stringify(postData);
        req.headers = {'Content-Type' : 'application/x-www-form-urlencoded'};
    } else {
        req.url += '/access_token?' + querystring.stringify(postData);
    }
    request(req, function(err, resp, body) {
        try {
            body = JSON.parse(body);
        } catch(err) {
            body = querystring.parse(body);
        }
        var auth = {accessToken: body.access_token};
        if(method == 'POST') auth = {token: body, clientID: theseKeys.appKey, clientSecret: theseKeys.appSecret};
        if(typeof authModule.authComplete == 'function') {
            return authModule.authComplete(auth, function(err, auth) {
                if(err) return res.send(err, 500);
                finishAuth(js, auth, res);
            });
        }
        finishAuth(js, auth, res);
    });
}

// save out auth and kick-start synclets, plus respond
function finishAuth(js, auth, res) {
    logger.info("authorized "+js.id);
    js.auth = auth;
    js.authed = Date.now();
    // upsert it again now that it's auth'd, significant!
    serviceManager.mapUpsert(path.join(js.srcdir,'package.json'));
    syncManager.syncNow(js.id, function(){}); // force immediate sync too
    res.end("<script type='text/javascript'>  window.opener.syncletInstalled('" + js.id + "'); window.close(); </script>");
}
