'use strict';

const CMS = require('./app');

new CMS('localhost', 'cmsDB');

//let results = await this.insertOne('cms', { _id: 'settings', key1: 'value 1' });
//this.log(`insertOne(): ${JSON.stringify(results)}`);

//let results = await this.findOne('cms', { _id: 'settings' });
//this.log(`findOne(): ${JSON.stringify(results)}`);

//let results = await this.find('cms');
//this.log(`find(): ${JSON.stringify(results)}`);

//let results = await this.updateOne('cms', { _id: 'settings' }, { $set: { key1: 'value 2' } });
//this.log(`updateOne(): ${JSON.stringify(results)}`);

//let results = await this.deleteOne('cms', { _id: 'settings' });
//this.log(`deleteOne(): ${JSON.stringify(results)}`);