const fs = require('fs');
const path = require('path');
const stream = require('stream');
const cassandraClient = require('../../databases/cassandra');
const { logTimeAndResolve } = require('./ETLHelper.js');

const photos = path.join(__dirname, '../../data/photos.csv');

const sanitizeData = new stream.Transform({ objectMode: true });
const csvParse = new stream.Transform({ objectMode: true });

sanitizeData._transform = function (chunk, encoding, done) {
  this.push(chunk);
  done();
};

csvParse._transform = function (chunk, encoding, done) {
  let rows = chunk.split('\n');
  rows.forEach((row) => {
    let cells = row.split(',');

    let newCells = cells.map((cell) => {
      return cell.replace(/"/gi, '');
    });
    // newCells[1] = Number(newCells[1]);
    this.push(newCells);
  });
  done();
};

const photosETL = () => {
  return new Promise((res, rej) => {
    const queryTemplate = `INSERT INTO sdc.photos (style_id, photos) VALUES (?, ?)`;
    const readStream = fs.createReadStream(photos, 'utf-8');
    console.log('==>**photo ETL started');
    readStream.pipe(csvParse).pipe(sanitizeData);
    const timeBefore = new Date();
    let prevId = 1;
    let cache = [];
    sanitizeData
      .on('data', (data) => {
        let id = data[1];
        if (prevId === id && data.length === 4) {
          cache.push({ thumbnail_url: data[3], url: data[2] });
        } else {
          if (data.length === 4) {
            cache.push({ thumbnail_url: data[3], url: data[2] });
            cassandraClient
              .execute(queryTemplate, [prevId, cache], { prepare: true })
              .then(() => {})
              .catch((err) => {
                rej(err);
              });
            prevId = id;
            cache = [];
          }
        }
      })
      .on('end', () => {
        logTimeAndResolve(timeBefore, 'photos', res);
      });
  });
};

module.exports = photosETL;
