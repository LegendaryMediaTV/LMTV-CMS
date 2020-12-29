'use strict';
const express = require('express');  // web server
const helmet = require('helmet');  // help secure Express with HTTP headers
const bs = require('@legendarymediatv/bootstrap');  // Bootstrap functionality
const htmlEscaper = require('html-escaper');  // escape/unescape HTML entities
const morgan = require('morgan');  // HTTP request logger
const MongoClient = require('mongodb').MongoClient;
const packageInfo = require('./package.json');  // get package information

const cmsTemplateDivider = '//////////////////// TEMPLATE DIVIDER ////////////////////\r\n';

/** Content Management System */
module.exports = class CMS {
    /**
     * start the Express service and add endpoints from the given database
     * @param {any} server MongoDB server
     * @param {any} database MongoDB database
     * @param {any} username MongoDB username
     * @param {any} password MongoDB password
     * @param {number} port MongoDB port
     * @todo uncomment things once converted to promises
     */
    constructor(server, database, username, password, port) {
        // enforce requirements
        if (!server || !database)
            throw 'MongoDB server and database are required';
        if (username && !password)
            throw 'MongoDB password is required when a username is provided';

        // set defaults
        if (!port)
            port = 27017;

        // retain database connection information
        this._connectionString = 'mongodb://';
        if (username)
            this._connectionString += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        this._connectionString += `${server}:${port}`;
        this.log(`MongoDB connection: ${this._connectionString}`);
        this._database = database;
        this.log(`MongoDB database: ${this._database}`);
        if (username)
            this.log(`MongoDB username: ${username}`);

        // get CMS settings from the database
        this.findOne('cms', { _id: 'settings' })
            .then(async (settings) => {
                // migrate and retry
                if (!settings || this._webapp.get('env') == 'development') {
                    await this.migrate(this._webapp.get('env') == 'development');
                    settings = await this.findOne('cms', { _id: 'settings' });
                }

                // still no settings, error out
                if (!settings)
                    throw new Error('Unable to find CMS settings');
                // settings found, retain them
                else
                    this.settings = settings;
            })
            .catch((err) => { throw new Error(err); });

        // TODO: set the timezone: https://github.com/TooTallNate/node-time
        // https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
    }


    /**********************
     ***** Properties *****
     *********************/

    /**
     * database connection string
     * @type {string}
     * @protected
     */
    _connectionString;

    /**
     * database name
     * @type {string}
     * @protected
     */
    _database;

    /**
     * Express application
     * @protected
     */
    _webapp;

    /**
     * log debug info to the console
     * @type {boolean}
     */
    debug;

    /**
     * CMS instance settings
     * @type {object}
     */
    settings;


    /***********************
     ***** CMS Methods *****
     **********************/

    /**
     * get page information
     * @param {string} search page ID
     * @returns {object}
     */
    findPage(search) {
        return new Promise(async (resolve, reject) => {
            try {
                // find the page in the database
                let page = await this.findOne('cmsPages', { _id: search });

                // add more metadata
                if (page) {
                    this.log(`Page found: ${page._id}`);

                    // determine the page URL
                    page.url = '/' + (page._id != 'home' ? page._id : '');

                    // replace template
                    page.template = await this.findOne('cmsTemplates', { _id: page.template });
                }

                resolve(page);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * start Express web server
     * @param {number} cmsWebPort web server port (defaults to process.env.PORT or 1337)
     */
    async listen(cmsWebPort) {
        // set defaults
        if (!cmsWebPort)
            cmsWebPort = process.env.PORT || 1337;

        // configure Express
        this._webapp = express();
        //this._webapp.use(express.urlencoded({ extended: true }));  // allow POST via HTML forms
        this._webapp.use(helmet({ contentSecurityPolicy: false }));  // enable Helmet, but allow pages to have external content
        //this._webapp.use(express.json());  // convert body to JSON object when it is JSON
        //this._webapp.use(express.static('public'));  // serve static content from the public folder to the root URL

        // log package/environment/config information
        this.debug = this._webapp.get('env') == 'development';
        this.log(`Application: ${packageInfo.description}`);
        this.log(`Version: ${packageInfo.version}`);
        this.log(`Environment: ${this._webapp.get('env')}`);

        // configure Morgan
        if (this.debug) {
            this._webapp.use(morgan('tiny'));
            this.log('Morgan enabled');
        }

        // route all traffic through centralized router
        this._webapp.use(async (req, res, next) => {
            try {
                let cmsPage;

                // loop through tokens in reverse order, loking for a matching page
                const cmsTokens = req.originalUrl.toLowerCase().split('/');
                for (let cmsTokenIndex = cmsTokens.length - 1; cmsTokenIndex >= 0; cmsTokenIndex--) {
                    // normalize URL token
                    if (cmsTokens[cmsTokenIndex] == '')
                        cmsTokens[cmsTokenIndex] = 'home';
                    else
                        cmsTokens[cmsTokenIndex] = cmsTokens[cmsTokenIndex];

                    this.log(`URL Token (${cmsTokenIndex + 1}): ${cmsTokens[cmsTokenIndex]}`);

                    // get page information
                    cmsPage = await this.findPage(cmsTokens[cmsTokenIndex]);
                    if (cmsPage) {
                        this.log(`Page: ${JSON.stringify(cmsPage, null, 4)}`);

                        break;
                    }
                }

                // home page not found, do migration and find home page again
                if (!cmsPage) {
                    await this.migrate();
                    cmsPage = await this.findOne('cmsPages', { '_id': 'home' });
                    if (!cmsPage)
                        throw new Error('Unable to find Home page');
                }

                // TODO: enforce URL
                // res.redirect(301, '/');

                let output;


                // evaluate the template header
                try { eval(cmsPage.template.header); }
                // evaluation failed, show error
                catch (err) {
                    output = new bs.HTML(htmlEscaper.escape(cmsPage._id == 'home' ? packageInfo.description : cmsPage.title));

                    // enable Bootstrap
                    output.bootstrap(
                        this.settings.bootstrapCSS,
                        this.settings.bootstrapJS,
                        true,
                        this.settings.jqueryJS,
                        this.settings.popperJS,
                        this.settings.fontawesomeCSS
                    );


                    output.alert([new bs.Heading1('CMS Template header error'), err], { theme: 'danger' });
                }

                // evaluate the page body
                try { eval(cmsPage.body); }
                // evaluation failed, show error
                catch (err) { output.alert([new bs.Heading1('CMS Page body error'), err], { theme: 'danger' }); }

                // show page information
                if (this.debug && output instanceof bs.HTML) {
                    const cmsDebugMonospace = { borderLeft: true, borderTheme: 'info', marginLeft: 3, paddingLeft: 3 };
                    const cmsDebugAlert = new bs.Alert(null, { theme: 'info' });
                    cmsDebugAlert.displayHeading1('Source');
                    cmsDebugAlert.heading2('Page JSON');
                    cmsDebugAlert.monospace(htmlEscaper.escape(JSON.stringify(cmsPage, null, 4)), cmsDebugMonospace);
                    cmsDebugAlert.heading2('Template header');
                    cmsDebugAlert.monospace(htmlEscaper.escape(cmsPage.template.header), cmsDebugMonospace);
                    cmsDebugAlert.heading2('Page body');
                    cmsDebugAlert.monospace(htmlEscaper.escape(cmsPage.body), cmsDebugMonospace);
                    cmsDebugAlert.heading2('Template footer');
                    cmsDebugAlert.monospace(htmlEscaper.escape(cmsPage.template.footer), cmsDebugMonospace);
                    output.add(cmsDebugAlert);
                }

                // evaluate the template footer
                try { eval(cmsPage.template.footer); }
                // evaluation failed, show error
                catch (err) { output.alert([new bs.Heading1('CMS Template footer error'), err], { theme: 'danger' }); }

                // send response
                res.send(output.toString());
            }
            catch (err) { next(err); }
        });

        // 500 server error
        this._webapp.use(function (err, req, res) {
            console.error(err.stack);
            res.sendStatus(500);
        });

        // start web server
        const cmsNow = new Date();
        this._webapp.listen(cmsWebPort, () => this.log(
            `Listening on port ${cmsWebPort} @ ${cmsNow.getHours()}`
            + ':' + cmsNow.getMinutes().toString().padStart(2, '0')
            + ':' + cmsNow.getSeconds().toString().padStart(2, '0')
            + ' ...'
        ));
    }

    /**
     * log output to the console if debugging enabled
     * @param {any} output
     */
    log(output) {
        if (this.debug)
            console.log(typeof output == 'object' ? JSON.stringify(output) : output);
    }

    /**
     * ensure the latest structure and settings are in place
     * @param {true} force force the migration (i.e., upsert) 
     */
    migrate(force) {
        return new Promise(async (resolve, reject) => {
            try {
                const fs = require('fs');  // enable filesystem functionality
                const path = require('path');  // enable path functionality

                // read seed data files
                const dir = await fs.promises.opendir(fs.existsSync('./seed') ? './seed' : './node_modules/@legendarymediatv/cms/MySQL/seed');
                for await (const entry of dir) {
                    const entryPath = path.parse(entry.name);

                    // JSON files are NoSQL documents
                    if (entryPath.ext == '.json') {
                        // parse file name for collection and _id
                        const collection = entryPath.name.substr(0, entryPath.name.indexOf('-'));
                        const id = entryPath.name.substr(entryPath.name.indexOf('-') + 1);

                        // see if the document already exists
                        let document = await this.findOne(collection, { _id: id });

                        // document not found, add it
                        if (!document || force) {
                            // read in document from the file and convert it to JSON
                            document = await fs.promises.readFile(`${dir.path}/${entry.name}`, { encoding: 'utf-8' });
                            document = JSON.parse(document);

                            if (['cmsPages', 'cmsTemplates'].includes(collection)) {
                                // read corresponding source file into the document
                                try {
                                    let source = await fs.promises.readFile(`${dir.path}/${entryPath.name}.js`, { encoding: 'utf-8' });

                                    if (collection == 'cmsPages')
                                        document.body = source;
                                    else {
                                        source = source.split(cmsTemplateDivider);
                                        if (source.length != 3)
                                            throw new Error(`CMS Template source must have three parts: ${collection}.${id} (${source.length})`);

                                        document.header = source[0].length ? source[0] : null;
                                        document.body = source[1].length ? source[1] : null;
                                        document.footer = source[2].length ? source[2] : null;
                                    }
                                }
                                catch (err) { }

                                // add dynamic metadata to pages/templates
                                document.created = new Date();
                                document.updated = new Date();
                            }

                            // add/update the document
                            document = await this.replaceOne(collection, { _id: id }, document, { upsert: true });
                            this.log(`Upserted ${collection}.${id}: ${JSON.stringify(document)}`);
                        }
                    }
                }

                resolve(true);
            }
            catch (err) { reject(new Error(err)); }
        });
    }


    /****************************
     ***** Database Methods *****
     ***************************/

    /**
     * delete multiple MongoDB documents
     * https://docs.mongodb.com/manual/reference/method/db.collection.deleteMany/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#deleteMany
     */
    deleteMany(collection, filter, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).deleteMany(filter, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * delete a MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.deleteOne/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#deleteOne
     */
    deleteOne(collection, filter, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).deleteOne(filter, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * find MongoDB documents
     * https://docs.mongodb.com/manual/reference/method/db.collection.find/
     * @param {string} collection MongoDB collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#find
     */
    find(collection, filter, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).find(filter, options).toArray();
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * find a MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.findOne/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#findOne
     */
    findOne(collection, filter, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).findOne(filter, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    // TODO: insertMany https://docs.mongodb.com/manual/reference/method/db.collection.insertMany/

    /**
     * add a new MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.insertOne/
     * @param {string} collection MongoDB collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} document A JSON document to insert into the collection.
     * @param {object} options Optional. A document expressing the write concern. Omit to use the default write concern. https://docs.mongodb.com/manual/reference/write-concern/
     */
    insertOne(collection, document, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!document || typeof document != 'object')
                    throw `MongoDB document is required and must be a JSON object: ${document}`;
                if (!options)
                    options = {};

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).insertOne(document, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * replace a MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.replaceMany/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} document The replacement JSON document.
     * @param {object} options Optional. Specifies additional query options.
     */
    replaceMany(collection, filter, document, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!document || typeof document != 'object')
                    throw `MongoDB document is required and must be JSON ${typeof document}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).replaceMany(filter, document, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * replace a MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.replaceOne/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} document The replacement JSON document.
     * @param {object} options Optional. Specifies additional query options.
     */
    replaceOne(collection, filter, document, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!document || typeof document != 'object')
                    throw `MongoDB document is required and must be JSON ${typeof document}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).replaceOne(filter, document, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * update multiple MongoDB documents
     * https://docs.mongodb.com/manual/reference/method/db.collection.updateMany/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} update The modifications to apply. https://docs.mongodb.com/manual/reference/method/db.collection.updateMany/#update-many-update
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#updateMany
     */
    updateMany(collection, filter, update, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!update || typeof update != 'object')
                    throw `MongoDB update is required and must be JSON ${typeof update}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connectionString, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).updateMany(filter, update, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * update a MongoDB document
     * https://docs.mongodb.com/manual/reference/method/db.collection.updateOne/
     * @param {string} collection NoSQL collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} filter Optional. Specifies selection filter using query operators. To return all documents in a collection, omit this parameter or pass an empty document ({}). https://docs.mongodb.com/manual/reference/operator/query/
     * @param {object} update The modifications to apply. https://docs.mongodb.com/manual/reference/method/db.collection.updateOne/#update-one-update
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#updateOne
     */
    updateOne(collection, filter, update, options) {
        return new Promise(async (resolve, reject) => {
            try {
                // enforce requirements
                if (!collection)
                    throw 'MongoDB collection is required';
                if (!filter)
                    filter = {};
                else if (typeof filter != 'object')
                    throw `MongoDB filter must be JSON: ${typeof filter}`;
                if (!update || typeof update != 'object')
                    throw `MongoDB update is required and must be JSON ${typeof update}`;
                if (!options)
                    options = {};
                else if (typeof options != 'object')
                    throw `MongoDB options must be JSON: ${typeof options}`;

                // query the database
                const client = await MongoClient.connect(this._connection, { useUnifiedTopology: true });
                const dbo = client.db(this._database);
                const results = await dbo.collection(collection).updateOne(filter, update, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }
}