#Microsoft Azure DocumentDB Node.js Q promises wrapper tests



##Running the tests



First You need to install mocha and q
> npm install mocha -g
> npm install q



Pack the local directory
> npm pack



Install to node_modules
> npm install documentdb-q-promises-<ver>.tgz



Edit _testConfig.js, supplying a host and masterKey for an existing DocumentDB account.

WARNING! - DO NOT use an account which contains objects or data which you care about. The test suite
cleans up after itself and may delete any or all contents.



From the test folder run 
> mocha -t 0 -R spec