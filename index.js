const fs = require('fs');
const async = require('async');
const child_process = require('child_process');
const readChunk = require('read-chunk');
const imageType = require('image-type');
const sqliteDatabase = require('better-sqlite3');

let path = (process.argv[2].endsWith('/') ? process.argv[2] : process.argv[2] + '/');
let found = [];
let counter = 0;
let db;

//Load database
try {
  db = new sqliteDatabase('./scandb.sqlite3');
  backupDb();
} catch (ex) {
  console.error(ex);
  throw new Error('Acessing the database-file failed.');
}

//Create the tables if necessary and fetch rows
console.log('Preparing db & Fetching data from it')
createTablesInDb();
found = loadFoundFromDb();

//Rescan if necessary
if (found.length === 0) {
  //Fetch processed rows form db
  let processed = loadProcessedFromDb();

  console.log('Scanning directory "' + process.argv[2]  + '".');
  found = fs.readdirSync(process.argv[2]).filter((el) => {
    return !processed.includes(el);
  });

  //Abort if no directories were found
  if (found.length === 0) {
    console.log('No directories were found.');
    return;
  } else {
    console.log('Inserting found directories into the database. This might take some time.');
    let timestamp = Date.now();
    insertFoundIntoDb(found);
    console.log('Operation took ' + (Date.now() - timestamp) + 'ms');
  }
} else {
  console.log('Resuming work on already queued directories');
}

//Start processing
console.log('Queue has ' + found.length + ' entries');
async.mapSeries(found, processDirectory, (err) => {
  if (err) {
    console.error(JSON.stringify(err, null, 2));
    throw new Error('A fatal error occured');
  } else {
    console.log('All done :)');
    return;
  }
});


//Function to create a backup of the db
function backupDb() {
  try {
    fs.copyFileSync('./scandb.sqlite3', './scandb.sqlite3.bak' + (Date.now()));
  } catch (ex) {
    console.error(ex);
    throw new Error('Backup of database failed');
  }
}

//Function to create the tables if necessary
function createTablesInDb(cb) {
  //Create tables (if they don't exist)
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS found (directory VARCHAR(50)); ' +
      'CREATE TABLE IF NOT EXISTS processed (directory VARCHAR(50), changes INTEGER); ' +
      'CREATE TABLE IF NOT EXISTS wrong_extensions (directory VARCHAR(50), file VARCHAR(12), correct_fileext VARCHAR(4))',
    );
  } catch (ex) {
    //Abort on error
    console.error(ex);
    throw new Error('Creating the tables failed.');
  }
}

//Function to get found from the db
function loadFoundFromDb() {
  try {
    //Load found directories from database & map the to better format
    return db.prepare('SELECT * FROM found').all().map((row) => row.directory);
  } catch (ex) {
    //Abort on error
    console.error(ex);
    throw new Error('Fetching rows from the db failed.');
  }
}

//Function to insert found into the db
function insertFoundIntoDb(found) {
  //Create chunks of 1k items
  let chunks = createChunkedArray(found, 1000);
  let finished = 0;

  try {
    //Insert the chunks
    for (let i = 0; i < chunks.length; i++) {
      var stmt = db.transaction(new Array(chunks[i].length).fill('INSERT INTO found VALUES (?)'));
      stmt.run(chunks[i]);
    }
  } catch (ex) {
    //Abort on error
    console.error(ex);
    throw new Error('Inserting the found directories failed');
  }
}

//Function the check if directory was already processed
function loadProcessedFromDb(cb) {
  try {
    //Load processed directories from database & map the to better format
    return db.prepare('SELECT directory FROM processed').all().map((row) => row.directory);
  } catch (ex) {
    //Abort on error
    console.error(ex);
    throw new Error('Fetching rows from the db failed.');
  }
}

//Function to add directory to processed and remove from found
function flagProcessed(directory, changes, cb) {
  try {
    //Insert & Remove
    db.prepare('DELETE FROM found WHERE directory = ?').run(directory);
    db.prepare('INSERT INTO processed VALUES (?, ?)').run(directory, changes);
  } catch (ex) {
    console.error(ex);
    throw new Error('Updating the database failed');
  }
}

//Function to add files with wrong extension to database
function reportWrongExtension(directory, file, realImageType) {
  try {
    //Insert
    db.prepare('INSERT INTO wrong_extensions VALUES (?, ?, ?)').run(directory, file, (realImageType !== null ? realImageType.ext : '?'));
  } catch (ex) {
    console.error(ex);
    throw new Error('Updating the database failed');
  }
}

//Function responsible for processing a directory/chapter
function processDirectory(directory, processDirectory_callback) {
  console.log('Processing "' + directory + '"');

  //Scan folder for content
  fs.readdir(path + directory, (fs_err, fs_files) => {
    //Abort if the directory-listing failed
    if (fs_err) {
      processDirectory_callback(fs_err);
    }

    //Process PNGs
    async.mapLimit(
      fs_files,
      4,
      (file, asyncFilter_callback) => {
        //Check if is PNG
        if (file.toLowerCase().endsWith('.png')) {
          //Abort if not really a PNG
          let realImageType = imageType(readChunk.sync((path + directory + '/' + file), 0, 12));
          if (!realImageType || realImageType.ext != 'png') {
            reportWrongExtension(directory, file, realImageType);
            return asyncFilter_callback(null, 0);
          }

          //Send to pngout
          child_process.exec(
            './pngout "' + (path + directory + '/' + file) + '"',
            (error, stdout, stderr) => {
              //Abort on error; Ignore Error 2: Could not make image smaller
              if (error && error.code !== 2) {
                asyncFilter_callback(error);
              } else if (!error) {
                let change = 0;

                try {
                  change = parseInt(stdout.match(/Chg:.*((-|\+)\d+)/)[1]);
                  if (isNaN(change)) { change = 0; }
                } catch (ex) {}

                asyncFilter_callback(null, change);
              } else {
                asyncFilter_callback(null, 0);
              }
            });
        } else {
          //Nothing to do
          asyncFilter_callback(null, 0);
        }
      },
      (mapLimit_error, changes) => {
        //Update, Save & Notify
        if (!mapLimit_error) {
          //Calculate total changes in size
          let chapter_change = changes.reduce((a, b) => a+b, 0);

          //Notify db & user
          flagProcessed(directory, chapter_change);
          console.log('Done! (' + (chapter_change >= 0 ? '+' : '') + chapter_change + ' b)');

          //Make backup if necessary
          counter++;
          if (counter % 100 === 0) { backupDb(); }

          //Report to async
          processDirectory_callback(null);
        } else {
          //Report error to async
          processDirectory_callback(mapLimit_error);
        }
      }
    );
  });
}

//Chunk array
function createChunkedArray(arr, chunkSize) {
    var chunks = [], i;

    for (i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }

    return chunks;
}
