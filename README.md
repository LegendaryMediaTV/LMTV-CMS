# LegendaryMediaTV CMS

This is a Node.js [Content Management System (CMS)](https://en.wikipedia.org/wiki/Content_management_system) that is currently being designed to work with [MongoDB](https://www.mongodb.com/).

***WARNING: It is currently in VERY early developmental stages and is not intended for use in a production environment.***

It returns a single class, which has methods for working with the database and adding endpoints via [Express](https://expressjs.com/).

```JavaScript
'use strict';

// add the CMS framework class
const CMS = require('@legendarymediatv/cms');

// anonymously connect to the local MongoDB instance, using the cmsDB database
const cms = new CMS('localhost', 'cmsDB');

// start the CMS web server
cms.listen();
```

*NOTE: if the database doesn't exist and/or it doesn't contain a `cmsSettings` collection/record and/or it doesn't contain a `cmsPages` collection/record for `home`, it will run the `migration()` method to add the missing pieces to the database*