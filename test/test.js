/*
The MIT License (MIT)
Copyright (c) 2014 Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

"use strict";

var DocumentDBClient = require("documentdb-q-promises").DocumentClientWrapper
  , DocumentBase = require("documentdb-q-promises").DocumentBase
  , assert = require("assert")
  , Stream = require("stream")
  , testConfig = require("./_testConfig")
  , Q = require("q");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var host = testConfig.host;
var masterKey = testConfig.masterKey;

describe("NodeJS Client Q promise Wrapper CRUD Tests", function(){

    function validateCRUDAsync(client, parentLink, options) {
        var deferred = Q.defer(),
            className = options.className,
            replaceProperties = options.replaceProperties,
            replacePropertiesForUpsert = options.replacePropertiesForUpsert,
            resourceDefinition = options.resourceDefinition,
            useUpsert = options.useUpsert || false,
            validateCreate = options.validateCreate,
            validateReplace = options.validateReplace,
            validateReplaceWithUpsert = options.validateReplaceWithUpsert;

        var resources, replacedResource, readResource, createdResource, beforeCount;

        client["read" + className + "s"](parentLink).toArrayAsync()
            // create or upsert
            .then(function (response) {
                resources = response.feed;
                assert.equal(resources.constructor, Array, "Value should be an array");
                beforeCount = resources.length;
                if (parentLink && useUpsert) {
                    return client["upsert" + className + "Async"](parentLink, resourceDefinition);
                } else if (parentLink) {
                    return client["create" + className + "Async"](parentLink, resourceDefinition);
                } else {
                    return client["create" + className + "Async"](resourceDefinition);
                }
            })
            // read
            .then(function (response) {
                createdResource = response.resource;
                validateCreate(createdResource);
                return client["read" + className + "s"](parentLink).toArrayAsync();
            })
            // query
            .then(function (response) {
                var resources = response.feed;
                assert(resources.length > 0, "number of resources for the query should be > 0");
                if (parentLink) {
                    var querySpec = {
                        query: "select * FROM root r WHERE r.id=@id",
                        parameters: [
                            {
                                name: "@id",
                                value: resourceDefinition.id
                            }
                        ]
                    };
                    return client["query" + className + "s"](parentLink, querySpec).toArrayAsync();
                } else {
                    return client["query" + className + "s"](querySpec).toArrayAsync();
                }
            })
            // replace or upsert
            .then(function (response) {
                var resources = response.feed;
                assert(resources.length > 0, "number of resources for the query should be > 0");
                if (className === "Database") {
                    createdResource = replaceProperties(createdResource);
                    return client["read" + className + "Async"](createdResource._self);
                } else {
                    if (useUpsert) {
                        createdResource = replacePropertiesForUpsert(createdResource);
                        return client["upsert" + className + "Async"](parentLink, createdResource);
                    } else {
                        createdResource = replaceProperties(createdResource);
                        return client["replace" + className + "Async"](createdResource._self, createdResource);
                    }
                }
            })
            // read
            .then(function (response) {
                replacedResource = response.resource;
                if (useUpsert) {
                    validateReplaceWithUpsert(createdResource, replacedResource);
                } else {
                    validateReplace(createdResource, replacedResource);
                }
                return client["read" + className + "Async"](replacedResource._self);
            })
            // delete
            .then(function (response) {
                var readResource = response.resource;
                assert.equal(replacedResource.id, readResource.id);
                return client["delete" + className + "Async"](readResource._self);
            })
            // read
            .then(function (response) {
                client["read" + className + "Async"](replacedResource._self).then(
                    function (response) {
                        assert.fail("", "", "request should return an error");
                    },
                    function (error) {
                        var notFoundErrorCode = 404;
                        assert.equal(error.code, notFoundErrorCode, "response should return error code 404");
                        deferred.resolve();
                    });
            })
            // handle any error
            .fail(function (error) {
                console.log("error", error, error.stack);
                assert.fail("", "", "an error occurred");
                deferred.reject(error);
            });

        return deferred.promise;
    }

    function createParentResourcesAsync(client, options) {
        var deferred = Q.defer();
        var createdResources = {};
        if (options.db) {
            client.createDatabaseAsync({ id: "sample database" })
                .then(function (response) {
                    var db = createdResources.createdDb = response.resource;
                    if (options.coll) {
                        client.createCollectionAsync(db._self, { id: "sample coll" })
                            .then(function (response) {
                                var coll = createdResources.createdCollection = response.resource;
                                if (options.doc) {
                                    client.createDocumentAsync(coll._self, { id: "sample doc" })
                                        .then(function (response) {
                                            var doc = createdResources.createdDoc = response.resource;
                                            deferred.resolve(createdResources);
                                        });
                                } else if (options.user) {
                                    client.createUserAsync(db._self, { id: "sample user" })
                                        .then(function (response) {
                                            var user = createdResources.createdUser = response.resource;
                                            deferred.resolve(createdResources);
                                        });
                                } else {
                                    deferred.resolve(createdResources);
                                }
                            });
                    } else if (options.user) {
                        client.createUserAsync(db._self, { id: "sample user" })
                            .then(function (response) {
                                var user = createdResources.createdUser = response.resource;
                                deferred.resolve(createdResources);
                            });
                    } else {
                        deferred.resolve(createdResources);
                    }
                })
                .fail(function (error) {
                    deferred.reject(error);
                });
        }

        return deferred.promise;
    }

    // remove all databases from the endpoint before each test
    beforeEach(function(done) {
        var client = new DocumentDBClient(host, {masterKey: masterKey});
        client.readDatabases().toArrayAsync()
            .then(function(result) {
                var databases = result.feed;
                var length = databases.length;
                if(length === 0){
                    return done();
                }

                var count = 0;
                databases.forEach(function(database){
                    client.deleteDatabaseAsync(database._self)
                        .then(function(){
                            count++;
                            if(count === length){
                                done();
                            }
                        },
                        function(err){
                            console.log(err);
                        });
                });
            },
            function(err){
                console.log(err);
                done();
            });
    });

    describe("Validate Database CRUD", function() {
        it("[promiseApi] Should do database CRUD operations successfully", function(done){
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            var validateOptions = {
                className: "Database",
                resourceDefinition: {id: "sampleDb"},
                validateCreate: function(created) {
                    assert.equal(created.id, "sampleDb", "wrong id");
                },
                validateReplace: function (created, replaced) {
                    // database doesn't support replace.
                },
                replaceProperties: function (resource) {
                    return resource;
                }
            };

            validateCRUDAsync(client, undefined, validateOptions)
                .then(function() {
                    done();
                })
                .fail(function(error) {
                    done();
                });

        });
    });

    describe("Validate Collection CRUD", function(){
        it("[promiseApi] Should do collection CRUD operations successfully", function(done){
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createParentResourcesAsync(client, {db: true})
                .then(function(createdResources) {
                    var validateOptions = {
                        className: "Collection",
                        resourceDefinition: {id: "sample coll", indexingPolicy: { indexingMode: "consistent" } },
                        validateCreate: function(created) {
                            assert.equal(created.id, "sample coll", "wrong id");
                        },
                        validateReplace: function(created, replaced) {
                            assert.equal(replaced.indexingPolicy.indexingMode,
                                "lazy",
                                "indexingMode should have changed");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replaceProperties: function (resource) {
                            resource.indexingPolicy.indexingMode = "lazy";
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdDb._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        });
    });

    describe("Validate Document CRUD", function() {
        var validateDocumentCrudTest = function (useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, coll: true })
                .then(function(createdResources) {
                    var validateOptions = {
                        className: "Document",
                        resourceDefinition: { id: "sample document", foo: "bar", key: "value" },
                        validateCreate: function(created) {
                            assert.equal(created.id, "sample document", "wrong id");
                            assert.equal(created.foo, "bar", "wrong property value");
                        },
                        validateReplace: function(created, replaced) {
                            assert.equal(replaced.id, "replaced document", "id property should change");
                            assert.equal(replaced.foo, "not bar", "property should have changed");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replaceProperties: function(resource) {
                            resource.id = "replaced document";
                            resource.foo = "not bar";
                            return resource;
                        },
                        replacePropertiesForUpsert: function (resource) {
                            resource.foo = "not bar";
                            return resource;
                        },
                        validateReplaceWithUpsert: function(created, replaced) {
                            assert.equal(replaced.foo, "not bar", "property should have changed");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        useUpsert: useUpsert
                    };

                    validateCRUDAsync(client, createdResources.createdCollection._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do document CRUD operations successfully", function (done) { validateDocumentCrudTest(false, done) });
        it("[promiseApi] Should do document CRUD operations successfully with upsert", function (done) { validateDocumentCrudTest(true, done) });

        var validateDocumentCrudWithPartitionResolverTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            var getPartitionResolver = function(collectionLink1, collectionLink2) {
                return {
                    getPartitionKey: function(document) {
                        return document.id;
                    },
                    resolve: function(partitionKey) {
                        var endsWith = function(str, suffix) {
                            return (str.indexOf(suffix, str.length - suffix.length) !== -1);
                        };

                        if (endsWith(partitionKey, "1")) {
                            return collectionLink1;
                        } else {
                            return collectionLink2;
                        }
                    },
                    resolveForCreate: function(partitionKey) {
                        return this.resolve(partitionKey);
                    },
                    resolveForRead: function(partitionKey) {
                        return [this.resolve(partitionKey)];
                    }
                };
            }
            var querySpec = {
                query: "SELECT * FROM root"
            };

            createParentResourcesAsync(client, { db: true }).then(function(createdResources) {
                var db = createdResources.createdDb;
                client.createCollectionAsync(db._self, { id: "sample coll 1" }).then(function(response) {
                    var collection1 = response.resource;
                    client.createCollectionAsync(db._self, { id: "sample coll 2" }).then(function(response) {
                        var collection2 = response.resource;

                        client.partitionResolvers["foo"] = getPartitionResolver(collection1._self, collection2._self);

                        client.createDocumentAsync("foo", { id: "sample doc 1" }).then(function(response) {
                            client.createDocumentAsync("foo", { id: "sample doc 2" }).then(function(response) {
                                client.createDocumentAsync("foo", { id: "sample doc 11" }).then(function(response) {
                                    client.queryDocuments("foo", querySpec, { partitionKey: "1" }).toArrayAsync().then(function(response) {
                                        assert(response.feed.length === 2, "number of documents in collection 1");
                                        client.queryDocuments("foo", querySpec, { partitionKey: "2" }).toArrayAsync().then(function(response) {
                                            assert(response.feed.length === 1, "number of documents in collection 2");
                                        }).then(function() {
                                            done();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        };

        it("[promiseApi] Should do document CRUD operations with a partition resolver successfully", function (done) { validateDocumentCrudWithPartitionResolverTest(false, done) });
        it("[promiseApi] Should do document CRUD operations with a partition resolver successfully with upsert", function (done) { validateDocumentCrudWithPartitionResolverTest(true, done) });


    });

    describe("Validate Attachment CRUD", function(){
        var createReadableStream = function(firstChunk, secondChunk){
            var readableStream = new Stream.Readable();
            var chunkCount = 0;
            readableStream._read = function(n){
                if(chunkCount === 0){
                    this.push(firstChunk || "first chunk ");
                } else if(chunkCount === 1) {
                    this.push(secondChunk || "second chunk");
                } else {
                    this.push(null);
                }
                chunkCount++;
            };

            return readableStream;
        };

        var readMediaResponse = function(response, callback){
            var data = "";
            response.on("data", function(chunk) {
                data += chunk;
            });
            response.on("end", function() {
                if (response.statusCode >= 300) {
                    return callback({code: response.statusCode, body: data});
                }

                return callback(undefined, data);
            });
        };

        var validateAttachmentCrudTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, coll: true, doc: true })
                .then(function(createdResources) {
                    var attachmentDefinition = {
                        id: "dynamic attachment",
                        media: "http://xstore.",
                        MediaType: "Book",
                        Author: "My Book Author",
                        Title: "My Book Title",
                        contentType: "application/text"
                    };
                    var validateOptions = {
                        className: "Attachment",
                        resourceDefinition: attachmentDefinition,
                        validateCreate: function(created) {
                            assert.equal(created.MediaType, "Book", "invalid media type");
                            assert.equal(created.Author, "My Book Author", "invalid property value");
                        },
                        validateReplace: function(created, replaced) {
                            assert.equal(replaced.id, "dynamic attachment replaced", "invalid id");
                            assert.equal(replaced.MediaType, "Book", "invalid media type");
                            assert.equal(replaced.Author, "new author", "invalid property value");
                        },
                        replaceProperties: function (resource) {
                            resource.id = "dynamic attachment replaced"
                            resource.Author = "new author";
                            return resource;
                        },
                        replacePropertiesForUpsert: function(resource) {
                            resource.Author = "new author";
                            return resource;
                        },
                        validateReplaceForUpsert: function(created, replaced) {
                            assert.equal(replaced.MediaType, "Book", "invalid media type");
                            assert.equal(replaced.Author, "new author", "invalid property value");
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdDoc._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error, error.stack);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do attachment CRUD operations successfully", function (done) { validateAttachmentCrudTest(false, done) });
        it("[promiseApi] Should do attachment CRUD operations successfully with upsert", function(done) { validateAttachmentCrudTest(true, done) });

        it("[promiseApi] Should do attachment media operations successfully", function(done){
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            var validMediaOptions = { slug: "attachment name", contentType: "application/text" };
            var invalidMediaOptions = { slug: "attachment name", contentType: "junt/test" };
            var validAttachment;
            createParentResourcesAsync(client, { db: true, coll: true, doc: true }).then(function (createdResources) {
                var document = createdResources.createdDoc;
                var validMediaOptions = { slug: "attachment name", contentType: "application/text" };
                // create attachment with invalid content-type
                var contentStream = createReadableStream();
                client.createAttachmentAndUploadMediaAsync(document._self, contentStream, invalidMediaOptions).then(function (response) {
                    assert.fail("", "", "create shouldn't have succeeded");
                }, function (error) {
                    var badRequestErrorCode = 400;
                    assert.equal(error.code, badRequestErrorCode);
                    contentStream = createReadableStream();
                    return client.createAttachmentAndUploadMediaAsync(document._self, contentStream, validMediaOptions);
                }).then(function (response) {
                    validAttachment = response.resource;
                    assert.equal(validAttachment.id, "attachment name", "id of created attachment should be the same as the one in the request");
                    return client.readMediaAsync(validAttachment.media);
                }).then(function (response) {
                    assert.equal(response.result, "first chunk second chunk");
                    contentStream = createReadableStream("modified first chunk ", "modified second chunk");
                    return client.updateMediaAsync(validAttachment.media, contentStream, validMediaOptions);
                }).then(function (response) {
                    return client.readMediaAsync(validAttachment.media);
                }).then(function (response) {
                    // read media streamed
                    assert.equal(response.result, "modified first chunk modified second chunk");
                    client.connectionPolicy.MediaReadMode = DocumentBase.MediaReadMode.Streamed;
                    return client.readMediaAsync(validAttachment.media);
                }).then(function (response) {
                    readMediaResponse(response.result, function (err, mediaResult) {
                        assert.equal(err, undefined, "error reading media response");
                        assert.equal(mediaResult, "modified first chunk modified second chunk");
                        done();
                    });
                }).fail(function (error) {
                    console.log(error);
                    done();
                });
            });
        });
    });

    describe("Validate User CRUD", function() {
        var userCrudTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true })
                .then(function(createdResources) {
                    var validateOptions = {
                        className: "User",
                        resourceDefinition: { id: "new user" },
                        validateCreate: function(created) {
                            assert.equal(created.id, "new user", "wrong id");
                        },
                        validateReplace: function(created, replaced) {
                            assert.equal(replaced.id, "replaced user", "id property should change");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replaceProperties: function(resource) {
                            resource.id = "replaced user";
                            return resource;
                        },
                        validateReplaceForUpsert: function (created, replaced) {
                            // Upsert on an exisiting user is a No Op
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replacePropertiesForUpsert: function (resource) {
                            // no properties other than id to update
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdDb._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do User CRUD operations successfully", function(done) { userCrudTest(false, done) });
        it("[promiseApi] Should do User CRUD operations successfully with upsert", function(done) { userCrudTest(true, done) });
    });

    describe("Validate Permission CRUD", function() {
        var permissionCrudTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, user: true, coll: true })
                .then(function(createdResources) {
                    var validateOptions = {
                        className: "Permission",
                        resourceDefinition: { id: "new permission", permissionMode: DocumentBase.PermissionMode.Read, resource: createdResources.createdCollection._self },
                        validateCreate: function(created) {
                            assert.equal(created.id, "new permission", "wrong id");
                            assert.equal(created.permissionMode, DocumentBase.PermissionMode.Read, "wrong permissionMode");
                            assert.equal(created.resource, createdResources.createdCollection._self, "wrong resource");
                        },
                        validateReplace: function(created, replaced) {
                            assert.equal(replaced.id, "replaced permission", "id property should change");
                            assert.equal(replaced.permissionMode, DocumentBase.PermissionMode.All, "permission mode should change");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replaceProperties: function(resource) {
                            resource.id = "replaced permission";
                            resource.permissionMode = DocumentBase.PermissionMode.All;
                            return resource;
                        },
                        validateReplaceForUpsert: function(created, replaced) {
                            assert.equal(replaced.permissionMode, DocumentBase.PermissionMode.All, "permission mode should change");
                            assert.equal(created.id, replaced.id, "id should stay the same");
                        },
                        replacePropertiesForUpsert: function(resource) {
                            resource.permissionMode = DocumentBase.PermissionMode.All;
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdUser._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do Permission CRUD operations successfully", function (done) { permissionCrudTest(false, done); });
        it("[promiseApi] Should do Permission CRUD operations successfully with upsert", function (done) { permissionCrudTest(true, done); });
    });

    describe("Validate Trigger CRUD", function() {
        var triggerCrudTest = function(userUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, coll: true })
                .then(function(createdResources) {
                    var triggerDefinition = {
                        id: "sample trigger",
                        serverScript: function() { var x = 10; },
                        triggerType: DocumentBase.TriggerType.Pre,
                        triggerOperation: DocumentBase.TriggerOperation.All
                    };

                    var validateOptions = {
                        className: "Trigger",
                        resourceDefinition: triggerDefinition,
                        validateCreate: function(created) {
                            for (var property in triggerDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(created.body, "function () { var x = 10; }");
                                } else {
                                    assert.equal(created[property], triggerDefinition[property], "property " + property + " should match");
                                }
                            }
                        },
                        validateReplace: function(created, replaced) {
                            for (var property in triggerDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else if (property === "id") {
                                    assert.equal(replaced.id, "sample trigger replaced", "id should match");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " + property + " should match");
                                }
                            }
                        },
                        replaceProperties: function (resource) {
                            resource.id = "sample trigger replaced";
                            resource.body = function() { var x = 20; };
                            return resource;
                        },
                        validateReplaceForUpsert: function(created, replaced) {
                            for (var property in triggerDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " +property + " should match");
                                }
                            }
                        },
                        replacePropertiesForUpsert: function(resource) {
                            resource.body = function() { var x = 20; };
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdCollection._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do trigger CRUD operations successfully", function(done) { triggerCrudTest(false, done); });
        it("[promiseApi] Should do trigger CRUD operations successfully with upsert", function(done) { triggerCrudTest(true, done); });
    });

    describe("Validate UDF CRUD", function() {
        var udfCrudTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, coll: true })
                .then(function(createdResources) {
                    var udfDefinition = { id: "sample udf", serverScript: function() { var x = 10; } };

                    var validateOptions = {
                        className: "UserDefinedFunction",
                        resourceDefinition: udfDefinition,
                        validateCreate: function(created) {
                            for (var property in udfDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(created.body, "function () { var x = 10; }");
                                } else {
                                    assert.equal(created[property], udfDefinition[property], "property " + property + " should match");
                                }
                            }
                        },
                        validateReplace: function(created, replaced) {
                            for (var property in udfDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else if (property === "id") {
                                    assert.equal(replaced.id, "sample udf replaced", "id should match");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " + property + " should match");
                                }
                            }
                        },
                        replaceProperties: function(resource) {
                            resource.id = "sample udf replaced";
                            resource.body = function () { var x = 20; };
                            return resource;
                        },
                        validateReplaceForUpsert: function(created, replaced) {
                            for (var property in udfDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " +property + " should match");
                                }
                            }
                        },
                        replacePropertiesForUpsert: function(resource) {
                            resource.body = function() { var x = 20; };
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdCollection._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do UDF CRUD operations successfully", function (done) { udfCrudTest(false, done); });
        it("[promiseApi] Should do UDF CRUD operations successfully with upsert", function(done) { udfCrudTest(true, done); });
    });

    describe("Validate sproc CRUD", function() {
        var sprocCrudTest = function(useUpsert, done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            createParentResourcesAsync(client, { db: true, coll: true })
                .then(function(createdResources) {
                    var sprocDefinition = {
                        id: "sample sproc",
                        serverScript: function() { var x = 10; }
                    };

                    var validateOptions = {
                        className: "StoredProcedure",
                        resourceDefinition: sprocDefinition,
                        validateCreate: function(created) {
                            for (var property in sprocDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(created.body, "function () { var x = 10; }");
                                } else {
                                    assert.equal(created[property], sprocDefinition[property], "property " + property + " should match");
                                }
                            }
                        },
                        validateReplace: function (created, replaced) {
                            for (var property in sprocDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else if (property === "id") {
                                    assert.equal(replaced.id, "sample sproc replaced", "id should match");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " + property + " should match");
                                }
                            }
                        },
                        replaceProperties: function (resource) {
                            resource.id = "sample sproc replaced";
                            resource.body = function () { var x = 20; };
                            return resource;
                        },
                        validateReplaceForUpsert: function (created, replaced) {
                            for (var property in sprocDefinition) {
                                if (property === "serverScript") {
                                    assert.equal(replaced.body, "function () { var x = 20; }");
                                } else {
                                    assert.equal(replaced[property], created[property], "property " + property + " should match");
                                }
                            }
                        },
                        replacePropertiesForUpsert: function (resource) {
                            resource.body = function () { var x = 20; };
                            return resource;
                        }
                    };

                    validateCRUDAsync(client, createdResources.createdCollection._self, validateOptions)
                        .then(function() {
                            done();
                        })
                        .fail(function(error) {
                            console.log(error);
                            done();
                        });
                });
        };

        it("[promiseApi] Should do sproc CRUD operations successfully", function (done) { sprocCrudTest(false, done); });
        it("[promiseApi] Should do sproc CRUD operations successfully with upsert", function(done) { sprocCrudTest(true, done); });
    });

    describe("Validate QueryIterator Functionality", function() {
        var createTestResources = function(client) {
            var deferred = Q.defer();
            var db, collection, doc1, doc2, doc3;
            client.createDatabaseAsync({ id: "sample database" })
                .then(function(response) {
                    db = response.resource;
                    return client.createCollectionAsync(db._self, {id: "sample collection"});
                })
                .then(function(response) {
                    collection = response.resource;
                    return client.createDocumentAsync(collection._self, {id: "doc1", prop1: "value1"});
                })
                .then(function(response) {
                    doc1 = response.resource;
                    return client.createDocumentAsync(collection._self, {id: "doc2", prop1: "value2"});
                })
                .then(function(response) {
                    doc2 = response.resource;
                    return client.createDocumentAsync(collection._self, {id: "doc3", prop1: "value3"});
                })
                .then(function(response) {
                    doc3 = response.resource;
                    var resources = {
                        coll: collection,
                        doc1: doc1,
                        doc2: doc2,
                        doc3: doc3
                    };
                    deferred.resolve(resources);
                })
                .fail(function(error){
                    deferred.reject(error);
                });

            return deferred.promise;
        };

        it("[promiseApi] validate QueryIterator iterator toArray", function(done) {
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createTestResources(client)
                .then(function(resources) {
                    var queryIterator = client.readDocuments(resources.coll._self, {maxItemCount: 2});
                    queryIterator.toArrayAsync()
                        .then(function(response) {
                            var docs = response.feed;
                            assert.equal(docs.length, 3, "queryIterator should return all documents using continuation");
                            assert.equal(docs[0].id, resources.doc1.id);
                            assert.equal(docs[1].id, resources.doc2.id);
                            assert.equal(docs[2].id, resources.doc3.id);
                            done();
                        })
                        .fail(function(error){
                            console.log("An error has occurred", error, error.stack);
                            done();
                        });
                })
                .fail(function(error){
                    console.log("An error has occurred", error, error.stack);
                    done();
                });
        });

        it("[promiseApi] validate queryIterator iterator forEach", function(done) {
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createTestResources(client)
                .then(function(resources) {
                    var queryIterator = client.readDocuments(resources.coll._self, {maxItemCount: 2});
                    var counter = 0;
                    // test queryIterator.forEach
                    queryIterator.forEach(function(err, doc) {
                        if (err) {
                            console.log("an error occurred", err, err.stack);
                            return done();
                        }

                        counter++;
                        if (counter === 1) {
                            assert.equal(doc.id, resources.doc1.id, "first document should be doc1");
                        } else if(counter === 2) {
                            assert.equal(doc.id, resources.doc2.id, "second document should be doc2");
                        } else if(counter === 3) {
                            assert.equal(doc.id, resources.doc3.id, "third document should be doc3");
                        }

                        if (doc === undefined) {
                            assert(counter < 5, "iterator should have stopped");
                            return done();
                        }
                    });
                })
                .fail(function(error){
                    console.log("An error has occurred", error, error.stack);
                    done();
                });
        });

        it("[promiseApi] validate queryIterator nextItem and hasMoreResults", function(done) {
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createTestResources(client)
                .then(function(resources) {
                    var queryIterator = client.readDocuments(resources.coll._self, {maxItemCount: 2});
                    assert.equal(queryIterator.hasMoreResults(), true);
                    queryIterator.nextItemAsync()
                        .then(function(response) {
                            var doc = response.resource;
                            assert.equal(doc.id, resources.doc1.id, "call queryIterator.nextItem after reset should return first document");
                            assert.equal(queryIterator.hasMoreResults(), true);
                            return queryIterator.nextItemAsync();
                        })
                        .then(function(response) {
                            var doc = response.resource;
                            assert.equal(doc.id, resources.doc2.id, "call queryIterator.nextItem again should return second document");
                            assert.equal(queryIterator.hasMoreResults(), true);
                            return queryIterator.nextItemAsync();
                        })
                        .then(function(response) {
                            var doc = response.resource;
                            assert.equal(doc.id, resources.doc3.id, "call queryIterator.nextItem again should return third document");
                            return queryIterator.nextItemAsync();
                        })
                        .then(function(response) {
                            var doc = response.resource;
                            assert.equal(doc, undefined, "queryIterator should return undefined if there is no elements");
                            done();
                        })
                        .fail(function(error){
                            console.log("An error has occurred", error, error.stack);
                            done();
                        });
                })
                .fail(function(error){
                    console.log("An error has occurred", error, error.stack);
                    done();
                });
        });

        it("[promiseApi] validate queryIterator iterator executeNext", function(done) {
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createTestResources(client)
                .then(function(resources) {
                    var queryIterator = client.readDocuments(resources.coll._self, {maxItemCount: 2});
                    queryIterator.executeNextAsync()
                        .then(function(response) {
                            var docs = response.feed;
                            assert.equal(docs.length, 2, "first batch size should be 2");
                            assert.equal(docs[0].id, resources.doc1.id, "first batch first document should be doc1");
                            assert.equal(docs[1].id, resources.doc2.id, "batch first second document should be doc2");
                            return queryIterator.executeNextAsync();
                        })
                        .then(function(response) {
                            var docs = response.feed;
                            assert.equal(docs.length, 1, "second batch size should be 2");
                            assert.equal(docs[0].id, resources.doc3.id, "second batch element should be doc3");
                            done();
                        })
                        .fail(function(error){
                            console.log("An error has occurred", error, error.stack);
                            done();
                        });
                })
                .fail(function(error){
                    console.log("An error has occurred", error, error.stack);
                    done();
                });
        });
    });

    describe("validate trigger functionality", function(){
        var triggers = [
            {
                id: "t1",
                body: function() {
                    var item = getContext().getRequest().getBody();
                    item.id = item.id.toUpperCase() + "t1";
                    getContext().getRequest().setBody(item);
                },
                triggerType: DocumentBase.TriggerType.Pre,
                triggerOperation: DocumentBase.TriggerOperation.All
            },
            {
                id: "t2",
                body: "function() { }", // trigger already stringified
                triggerType: DocumentBase.TriggerType.Pre,
                triggerOperation: DocumentBase.TriggerOperation.All
            },
            {
                id: "t3",
                body: function() {
                    var item = getContext().getRequest().getBody();
                    item.id = item.id.toLowerCase() + "t3";
                    getContext().getRequest().setBody(item);
                },
                triggerType: DocumentBase.TriggerType.Pre,
                triggerOperation: DocumentBase.TriggerOperation.All
            },
            {
                id: "response1",
                body: function() {
                    var prebody = getContext().getRequest().getBody();
                    if (prebody.id !== "TESTING POST TRIGGERt1") throw "id mismatch";
                    var postbody = getContext().getResponse().getBody();
                    if (postbody.id !== "TESTING POST TRIGGERt1") throw "id mismatch";
                },
                triggerType: DocumentBase.TriggerType.Post,
                triggerOperation: DocumentBase.TriggerOperation.All
            },
            {
                id: "triggerOpType",
                body: "function() { }",
                triggerType: DocumentBase.TriggerType.Post,
                triggerOperation: DocumentBase.TriggerOperation.Delete
            }
        ];


        var createTriggersImplementation = function(client, collection, index, deferred){
            if (index === triggers.length) {
                return deferred.resolve();
            }

            client.createTriggerAsync(collection._self, triggers[index])
                .then(function(trigger) {
                    createTriggersImplementation(client, collection, index + 1, deferred);
                })
                .fail(function(error){
                    console.log(error, error.stack);
                });
        };

        var createTriggersAsync = function(client, collection, index) {
            var deferred = Q.defer();
            createTriggersImplementation(client, collection, index, deferred);
            return deferred.promise;
        };

        it("[promiseApi] Should do trigger operations successfully", function(done){
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createParentResourcesAsync(client, {db: true, coll: true})
                .then(function(resources) {
                    var collection = resources.createdCollection;
                    createTriggersAsync(client, collection, 0)
                        .then(function(){
                            return client.createDocumentAsync(collection._self, { id: "doc1", key: "value" }, { preTriggerInclude: "t1" });
                        })
                        .then(function(response) {
                            assert.equal(response.resource.id, "DOC1t1", "id should be capitalized");
                            return client.createDocumentAsync(collection._self, { id: "doc2", key2: "value2" }, { preTriggerInclude: "t2" });
                        })
                        .then(function(response) {
                            assert.equal(response.resource.id, "doc2", "id shouldn't change");
                            return client.createDocumentAsync(collection._self, { id: "Doc3", prop: "empty" }, { preTriggerInclude: "t3" });
                        })
                        .then(function(response) {
                            assert.equal(response.resource.id, "doc3t3");
                            return client.createDocumentAsync(collection._self, { id: "testing post trigger" }, { postTriggerInclude: "response1", preTriggerInclude: "t1" });
                        })
                        .then(function(response) {
                            assert.equal(response.resource.id, "TESTING POST TRIGGERt1");
                            return client.createDocumentAsync(collection._self, { id: "responseheaders" }, { preTriggerInclude: "t1" });
                        })
                        .then(function(response) {
                            assert.equal(response.resource.id, "RESPONSEHEADERSt1");
                            return client.createDocumentAsync(collection._self, { id: "Docoptype" }, { postTriggerInclude: "triggerOpType" });
                        })
                        .then(function(response) {
                            assert.fail("", "", "request shouldn't succeed");
                        },
                        function(error){
                            done();
                        })
                        .fail(function(error) {
                            console.log("error", error, error.stack);
                            assert.fail("", "", "an error occurred");
                            done();
                        });
                })
                .fail(function(error) {
                    console.log("error", error, error.stack);
                    assert.fail("", "", "an error occurred");
                    done();
                });
        });
    });

    describe("validate stored procedure functionality", function () {
        it("[promiseApi] Should do stored procedure operations successfully", function (done) {
            var client = new DocumentDBClient(host, {masterKey: masterKey});
            createParentResourcesAsync(client, {db: true, coll: true}).then(function(resources) {
                var collection = resources.createdCollection;
                var sproc1 = {
                    id: "storedProcedure1",
                    body: function () {
                        for (var i = 0; i < 1000; i++) {
                            var item = getContext().getResponse().getBody();
                            if (i > 0 && item !== i - 1) throw "body mismatch";
                            getContext().getResponse().setBody(i);
                        }
                    }
                };

                client.createStoredProcedureAsync(collection._self, sproc1).then(function (response) {
                    return client.executeStoredProcedureAsync(response.resource._self);
                }).then(function(response) {
                    assert.equal(response.result, 999);
                    var sproc2 = {
                        id: "storedProcedure2",
                        body: function () {
                            for (var i = 0; i < 10; i++) getContext().getResponse().appendValue("Body", i);
                        }
                    };

                    return client.createStoredProcedureAsync(collection._self, sproc2);
                }).then(function(response) {
                    return client.executeStoredProcedureAsync(response.resource._self);
                }).then(function(response) {
                    assert.equal(response.result, 123456789);
                    var sproc3 = {
                        id: "storedProcedure3",
                        body: function (input) {
                            getContext().getResponse().setBody("a" + input.temp);
                        }
                    };

                    return client.createStoredProcedureAsync(collection._self, sproc3);
                }).then(function(response) {
                    return client.executeStoredProcedureAsync(response.resource._self, {temp: "so"});
                }).then(function(response) {
                    assert.equal(response.result, "aso");
                    done();
                }).fail(function(error) {
                    console.log("error", error, error.stack);
                    assert.fail("", "", "an error occurred");
                    done();
                });
            }).fail(function(error) {
                console.log("error", error, error.stack);
                assert.fail("", "", "an error occurred");
                done();
            });
        });
    });

    describe("Validate Offer CRUD", function () {
        it("[promiseApi] Should do offer CRUD operations successfully", function (done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });
            var existingOffer;
            createParentResourcesAsync(client, { db: true, coll: true })
                .then(function (createdResources) {
                    return client.readOffers().toArrayAsync();
                }).then(function (result) {
                    var offers = result.feed;
                    assert.equal(offers.length, 1);
                    existingOffer = offers[0];
                    assert.equal(existingOffer.offerType, "S1");  // S1 is the default type
                    return client.readOfferAsync(existingOffer._self);
                }).then(function (response) {
                    var readOffer = response.resource;
                    assert.equal(readOffer.id, existingOffer.id);
                    assert.equal(readOffer._rid, existingOffer._rid);
                    assert.equal(readOffer._self, existingOffer._self);
                    assert.equal(readOffer.offerType, existingOffer.offerType);
                    // Replace offer.
                    readOffer.offerType = "S2";
                    return client.replaceOfferAsync(readOffer._self, readOffer);
                }).then(function (response) {
                    var replacedOffer = response.resource;
                    assert.equal(replacedOffer.offerType, "S2");
                    // Query for offer.
                    var querySpec = {
                        query: "select * FROM root r WHERE r.id=@id",
                        parameters: [
                            {
                                name: "@id",
                                value: existingOffer.id
                            }
                        ]
                    };
                    return client.queryOffers(querySpec).toArrayAsync();
                }).then(function (result) {
                    var offers = result.feed;
                    assert.equal(offers.length, 1);
                    var oneOffer = offers[0];
                    assert.equal(oneOffer.offerType, "S2");
                    done();
                }).fail(function (error) {
                    console.log(error, error.stack);
                    done();
                });
        });

        it("[promiseApi] Should create Collection with specified offer type successfully", function (done) {
            var client = new DocumentDBClient(host, { masterKey: masterKey });

            client.createDatabaseAsync({ id: "sample database" })
                .then(function (response) {
                    var db = response.resource;
                    return client.createCollectionAsync(db._self, { id: "sample coll" }, { offerType: "S2" });
                }).then(function (response) {
                    return client.readOffers().toArrayAsync();
                }).then(function (result) {
                    var offers = result.feed;
                    assert.equal(offers.length, 1);
                    var existingOffer = offers[0];
                    assert.equal(existingOffer.offerType, "S2");  // S2 is what we created.
                    done();
                }).fail(function (error) {
                    console.log(error, error.stack);
                    done();
                });
        });
    });
});