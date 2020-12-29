'use strict';

const CMS = require('./app');

// anonymously connect to the local MongoDB instance, using the cmsDB database
const cms = new CMS('localhost', 'cmsDB');

// start the CMS web server
cms.listen();