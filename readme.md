#Windows Azure DocumentDB Node.js Q promises wrapper

DocumentDB is a purpose built NoSQL JSON document database designed for modern mobile and web applications. DocumentDB supports rich queries over JSON data as well as, transactional execution of JavaScript based application logic. DocumentDB is built with a deep commitment to the JSON data model enabling it to offer differentiated query and data processing capabilities that scale to meet the needs of the most demanding modern applications.

This is a wrapper of the [Azure DocumentDB Node.js SDK](https://github.com/Azure/azure-documentdb-node) using the [Q promises](https://github.com/kriskowal/q) 

##Installing the library using npm
	npm install documentdb-q-promises</pre></p>

##Hello world example code using Q promises
```js
	var DocumentClient = require('documentdb-q-promises').DocumentClientWrapper;
	
	var host = [hostendpoint];                    // Add your endpoint
	var masterKey = [database account masterkey]; // Add the massterkey of the endpoint
	
	var client = new DocumentClient(host, {masterKey: masterKey});
	var databaseDefinition = { id: "sample database" }
	var collectionDefinition = { id: "sample collection" };
	var documentDefinition = { id: "hello world doc", content: "Hello World!" };
	
	var database, collection, document;
	client.createDatabaseAsync(databaseDefinition)
    	.then(function(databaseResponse) {
        	database = databaseResponse.resource;
        	return client.createCollectionAsync(database._self, collectionDefinition);
    	})
    	.then(function(collectionResponse) {
        	collection = collectionResponse.resource;
        
        	return client.createDocumentAsync(collection._self, documentDefinition);
    	})
		.then(function(documentResponse) {
			var document = documentResponse.resource;
			console.log('Created Document with content: ', document.content);
		})
    	.fail(function(error) {
        	console.log("An error occured", error);
    	});
 ```
