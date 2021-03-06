'use strict'; // http://www.w3schools.com/js/js_strict.asp

// token handling in session
var token = require('./token');

// web framework
var express = require('express');
var router = express.Router();

var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();
var rawParser = bodyParser.raw({limit: '10mb'});

var formidable = require('formidable');
var path = require('path');
var fs = require('fs');

var config = require('./config');

var forgeSDK = require('forge-apis');

// actually perform the token operation
var oauth = require('./oauth');

router.post('/buckets', jsonParser, function (req, res) {
    var tokenSession = new token(req.session);

    var bucketName = req.body.bucketName
    var bucketType = req.body.bucketType

    var buckets = new forgeSDK.BucketsApi();
    buckets.createBucket({
          "bucketKey": bucketName,
          "policyKey": bucketType
    }, {}, tokenSession.getOAuth(), tokenSession.getCredentials())
      .then(function (data) {
            res.json(data.body)
      })
      .catch(function (error) {
          res.status(error.statusCode).end(error.statusMessage);
      })

})

router.get('/files/:id', function (req, res) {
    var id = req.params.id
    var boName = getBucketKeyObjectName(id)

    var tokenSession = new token(req.session);

    var objects = new forgeSDK.ObjectsApi();
    objects.getObject(boName.bucketKey, boName.objectName, {}, tokenSession.getOAuth(), tokenSession.getCredentials())
      .then(function (data) {
          var fileParts = boName.objectName.split('.')
          var fileExt = fileParts[fileParts.length - 1];
          res.set('content-type', 'application/octet-stream');
          res.set('Content-Disposition', 'attachment; filename="' + boName.objectName + '"');
          res.end(data.body);
      })
      .catch(function (error) {
          res.status(error.statusCode).end(error.statusMessage);
      });
})

router.delete('/files/:id', function (req, res) {
    var tokenSession = new token(req.session)

    var id = req.params.id
    var boName = getBucketKeyObjectName(id)

    var objects = new forgeSDK.ObjectsApi();
    var objectName = decodeURIComponent(boName.objectName)
    objects.deleteObject(boName.bucketKey, objectName, tokenSession.getOAuth(), tokenSession.getCredentials())
      .then(function (data) {
          res.json({ status: "success" })
      })
      .catch(function (error) {
          res.status(error.statusCode).end(error.statusMessage);
      })
})

router.get('/files/:id/publicurl', function (req, res) {
    var id = req.params.id
    var boName = getBucketKeyObjectName(id)

    var tokenSession = new token(req.session);

    var objects = new forgeSDK.ObjectsApi();
    objects.createSignedResource(boName.bucketKey, boName.objectName, {}, {}, tokenSession.getOAuth(), tokenSession.getCredentials())
      .then(function (data) {
          res.json(data.body);
      })
      .catch(function (error) {
          res.status(error.statusCode).end(error.statusMessage);
      });
})

router.delete('/buckets/:id', function (req, res) {
    oauth.getTokenInternal().then(function (credentials) {

        var id = req.params.id

        var buckets = new forgeSDK.BucketsApi();
        buckets.deleteBucket(id, oauth.OAuthClient(), credentials)
        .then(function (data) {
            res.json({ status: "success" })
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        })
    });
})


router.post('/files', jsonParser, function (req, res) {
    // Uploading a file to app bucket

    var tokenSession = new token(req.session);

    var fileName = '';
    var form = new formidable.IncomingForm();
    var uploadedFile;
    var bucketName = req.headers.id

    // Receive the file
    var fileData;

    form
        .on('data', function(data) {
            fileData = data;
        })

        .on('field', function (field, value) {
            console.log(field, value);
        })
        .on('file', function (field, file) {
            console.log(field, file);
            uploadedFile = file;
        })
        .on('end', function () {
            if (uploadedFile.name == '') {
                res.status(500).end('No file submitted!');
            }

            console.log('-> file received');

            // Create file on A360
            fs.readFile(uploadedFile.path, function (err, fileData) {
                // Upload the new file
                var objects = new forgeSDK.ObjectsApi();
                objects.uploadObject(bucketName, uploadedFile.name, uploadedFile.size, fileData, {}, tokenSession.getOAuth(), tokenSession.getCredentials())
                  .then(function (objectData) {
                      console.log('uploadObject: succeeded');
                      res.json(objectData.body);
                  })
                  .catch(function (error) {
                      console.log('uploadObject: failed');
                      res.status(error.statusCode).end(error.statusMessage);
                  });
            });

        });

    form.multiples = true;
    form.parse(req);
});

router.post('/chunks', rawParser, function (req, res) {
  // Uploading a file to app bucket

  var tokenSession = new token(req.session);

  var fileName = req.headers['x-file-name'];
  var bucketName = req.headers.id
  var data = req.body;
  var range = req.headers.range;
  var sessionId = req.headers.sessionid;

  // Upload the new file
  var objects = new forgeSDK.ObjectsApi();
  objects.uploadChunk(bucketName, fileName, data.length, range, sessionId, data, {}, tokenSession.getOAuth(), tokenSession.getCredentials())
    .then(function (objectData) {
      console.log('uploadObject: succeeded');
      res.status(objectData.statusCode).json(objectData.body);
    })
    .catch(function (error) {
      console.log('uploadObject: failed');
      try {
        res.status(error.statusCode).end(error.statusMessage);
      } catch (Exception) {
        res.status(500).end("Unknown error");
      }
    });

});

function getBucketKeyObjectName(objectId) {
    // the objectId comes in the form of
    // urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_NAME
    var objectIdParams = objectId.split('/');
    var objectNameValue = objectIdParams[objectIdParams.length - 1];
    // then split again by :
    var bucketKeyParams = objectIdParams[objectIdParams.length - 2].split(':');
    // and get the BucketKey
    var bucketKeyValue = bucketKeyParams[bucketKeyParams.length - 1];

    var ret = {
        bucketKey: bucketKeyValue,
        objectName: objectNameValue
    };

    return ret;
}

//




/////////////////////////////////////////////////////////////////
// Provide information to the tree control on the client
// about the hubs, projects, folders and files we have on
// our A360 account
/////////////////////////////////////////////////////////////////
router.get('/treeNode', function (req, res) {
    var id = decodeURIComponent(req.query.id);
    console.log("treeNode for " + id);

    oauth.getTokenInternal().then(function (credentials) {

        if (id === '#') {
            // # stands for ROOT
            var buckets = new forgeSDK.BucketsApi();

            buckets.getBuckets({}, oauth.OAuthClient(), credentials)
                .then(function (data) {
                    res.json(makeTree(data.body.items, true));
                })
                .catch(function (error) {
                    console.log(error);
                });
        } else {
            var objects = new forgeSDK.ObjectsApi();

            objects.getObjects(id, {}, oauth.OAuthClient(), credentials)
            .then(function (data) {
                res.json(makeTree(data.body.items, false));
            })
            .catch(function (error) {
                console.log(error);
            });

        }
    });
});

/////////////////////////////////////////////////////////////////
// Collects the information that we need to pass to the
// file tree object on the client
/////////////////////////////////////////////////////////////////
function makeTree(items, isBucket) {
    if (!items) return '';
    var treeList = [];
    items.forEach(function (item, index) {

        var treeItem = {
            id: isBucket ? item.bucketKey : item.objectId,
            text: isBucket ? item.bucketKey + " [" + item.policyKey + "]" : item.objectKey,
            type: isBucket ? "bucket" : "object",
            sha1: item.sha1,
            children: isBucket
        };
        console.log(treeItem);
        treeList.push(treeItem);
    });

    return treeList;
}

/////////////////////////////////////////////////////////////////
// Return the router object that contains the endpoints
/////////////////////////////////////////////////////////////////
module.exports = router;