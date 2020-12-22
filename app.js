'use strict';
const express = require('express');  // web server
const helmet = require('helmet');  // help secure Express with HTTP headers
const bs = require('@legendarymediatv/bootstrap');  // Bootstrap functionality
const htmlEscaper = require('html-escaper');  // escape/unescape HTML entities
const morgan = require('morgan');  // HTTP request logger
//const mysql = require('mysql2/promise');  // MSSQL functionality
const MongoClient = require('mongodb').MongoClient;

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

        // configure Express
        const app = express();
        const webPort = process.env.PORT || 1337;  // web server port
        //app.use(express.urlencoded({ extended: true }));  // allow POST via HTML forms
        app.use(helmet({ contentSecurityPolicy: false }));  // enable Helmet, but allow pages to have external content
        //app.use(express.json());  // convert body to JSON object when it is JSON
        //app.use(express.static('public'));  // serve static content from the public folder to the root URL

        // log package/environment/config information
        const pkg = require('./package.json');  // get package information
        this.debug = app.get('env') == 'development';
        this.log(`Application: ${pkg.description}`);
        this.log(`Version: ${pkg.version}`);
        this.log(`Environment: ${app.get('env')}`);
        this.log(`Server: ${server}`);
        this.log(`Database: ${database}`);
        if (username)
            this.log(`Username: ${username}`);

        // retain database connection information
        this.connection = 'mongodb://';
        if (username)
            this.connection += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        this.connection += `${server}:${port}`;
        this.log(`MongoDB connection: ${this.connection}`);
        this.database = database;
        this.log(`MongoDB database: ${this.database}`);

        // configure Morgan
        if (this.debug) {
            app.use(morgan('tiny'));
            this.log('Morgan enabled...');
        }

        // route all traffic through centralized router
        app.use(async (req, res, next) => {
            try {
                let cmsSettings = await this.findOne('cms', { _id: 'settings' });
                if (!cmsSettings) {
                    await this.migrate();
                    cmsSettings = await this.findOne('cms', { _id: 'settings' });
                    if (!cmsSettings)
                        throw new Error('Unable to find CMS settings');
                }

                const urlTokens = req.originalUrl.toLowerCase().split('/');

                this.log(`URL: ${req.originalUrl}`);
                this.log(`URL Tokens (${urlTokens.length}): ${urlTokens}`);

                let page;

                // loop through tokens in reverse order
                for (let urlIndex = urlTokens.length - 1; urlIndex >= 0; urlIndex--) {
                    // normalize URL token
                    if (urlTokens[urlIndex] == '')
                        urlTokens[urlIndex] = 'home';
                    else
                        urlTokens[urlIndex] = urlTokens[urlIndex];

                    this.log(`URL Token (${urlIndex + 1}): ${urlTokens[urlIndex]}`);

                    // get page information
                    page = await this.findOne('cmsPages', { '_id': urlTokens[urlIndex] });
                    if (page) {
                        this.log(`Page: ${JSON.stringify(page)}`);

                        break;
                    }
                }

                // home page not found, do migration and find home page again
                if (!page) {
                    await this.migrate();
                    page = await this.findOne('cmsPages', { '_id': 'home' });
                    if (!page)
                        throw new Error('Unable to find Home page');
                }

                // TODO: enforce URL

                // TODO: use template to start HTML
                const html = new bs.HTML(htmlEscaper.escape(page._id == 'home' ? pkg.description : page.title));

                // TODO: pull Bootstrap info from siteSettings
                html.bootstrap();

                // evaluate the page content
                eval(page.source);

                // show page information
                if (this.debug) {
                    html.line();
                    html.display1('Source');
                    html.heading2('Page JSON');
                    html.monospace(JSON.stringify(page, null, 4));
                    html.heading2('Page Source');
                    html.monospace(page.source);
                }

                // send response
                res.send(html.toString());
            }
            catch (err) { next(err); }
        });

        // 500 server error
        app.use(function (err, req, res) {
            console.error(err.stack);
            res.sendStatus(500);
        });

        // start web server
        const now = new Date();
        app.listen(webPort, () => this.log(
            `Listening on port ${webPort} @ ${now.getHours()}`
            + ':' + now.getMinutes().toString().padStart(2, '0')
            + ':' + now.getSeconds().toString().padStart(2, '0')
            + ' ...'
        ));
    }


    /**********************
     ***** Properties *****
     *********************/

    /** database connection information [object] */
    connection;

    /** database name */
    database;

    /** log debug info to the console [boolean] */
    debug;


    /*******************
     ***** Methods *****
     ******************/

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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
                const results = await dbo.collection(collection).findOne(filter, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * add a new MongoDB document
     * @param {string} collection MongoDB collection to search. https://docs.mongodb.com/manual/core/databases-and-collections/#collections
     * @param {object} document JSON object
     * @param {object} options Optional. Specifies additional query options such as sort and projection to configure the result set. http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#findOne
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
                const results = await dbo.collection(collection).insertOne(document, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }

    /**
     * log output to the console if debugging enabled
     * @param {any} output
     */
    log(output) {
        if (this.debug)
            console.log(typeof output == 'object' ? JSON.stringify(output) : output);
    }

    /** ensure the latest structure and settings are in place */
    migrate() {
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
                        if (!document) {
                            this.log(`Adding ${collection}.${id}`);

                            // read in document from the file and convert it to JSON
                            document = await fs.promises.readFile(`${dir.path}/${entry.name}`, { encoding: 'utf-8' });
                            document = JSON.parse(document);

                            // read corresponding source file into document.source
                            if (collection == 'cmsPages') {
                                try { document.source = await fs.promises.readFile(`${dir.path}/${entryPath.name}.js`, { encoding: 'utf-8' }); }
                                catch (err) { }
                            }

                            // add the document
                            this.log(JSON.stringify(document, null, 4));
                            document = await this.insertOne(collection, document);
                            this.log(`Added document: ${document}`);
                        }
                    }
                }

                resolve(true);
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
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
                const client = await MongoClient.connect(this.connection, { useUnifiedTopology: true });
                const dbo = client.db(this.database);
                const results = await dbo.collection(collection).updateOne(filter, update, options);
                client.close();
                resolve(results);
            }
            catch (err) { reject(new Error(err)); }
        });
    }
}