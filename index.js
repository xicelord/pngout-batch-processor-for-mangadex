const fs = require('fs');
const async = require('async');
const child_process = require('child_process');

let counter = 0;
let scan = {
  path: '',
  processed: [],
  found: []
};

//Load scanfile if exists
try {
  scan = require('./scanfile.json');

  try {
    //Create a backup of the scanfile
    fs.copyFileSync('./scanfile.json', './scanfile.json.bak' + (Date.now()));
  } catch (ex) {
    console.log(JSON.stringify(ex, null, 2));
    console.log('Backup of scanfile failed');
    return;
  }
} catch (ex) {
  console.log('No readable scanfile found.');
}

//Rescan if necessary
if (scan.found.length === 0) {
  console.log('Scanning directory "' + process.argv[2]  + '". This might take some time.');
  scan.found = fs.readdirSync(process.argv[2]).filter((el) => {
    return !scan.processed.includes(el);
  });

  //TODO: FILTER ALREADY SCANNED!

  //Abort if no directories were found
  if (scan.found.length === 0) {
    console.log('No directories were found.');
    return;
  } else {
    scan.path = (process.argv[2].endsWith('/') ? process.argv[2] : process.argv[2] + '/');
    fs.writeFileSync('./scanfile.json', JSON.stringify(scan));
  }
} else {
  console.log('Resuming work on already queued directories');
}

console.log('Queue has ' + scan.found.length + ' entries');

//Copy array & Start processing (Reverse because shift is way more expensive than pop)
let found_copy = scan.found.slice().reverse();
async.mapSeries(found_copy, processDirectory, (err) => {
  if (err) {
    console.error(err);
    return;
  } else {
    console.log('All done :)');
    return;
  }
});


//Function responsible for processing a directory/chapter
function processDirectory(directory, processDirectory_callback) {
  console.log('Processing "' + directory + '"');

  //Scan folder for content
  fs.readdir(scan.path + directory, (err, files) => {
    //Process PNGs
    async.mapLimit(
      files,
      4,
      (file, asyncFilter_callback) => {
        //Check if is PNG
        if (file.toLowerCase().endsWith('.png')) {
          //Send to pngout
          child_process.exec(
            './pngout "' + (scan.path + directory + '/' + file) + '"',
            (error, stdout, stderr) => {
              //Abort on error; Ignore Error 2: Could not make image smaller
              if (error && error.code !== 2) {
                asyncFilter_callback(error);
              } else {
                asyncFilter_callback(null);
              }
            });
        } else {
          //Nothing to do
          asyncFilter_callback(null);
        }
      },
      (mapLimit_error) => {
        //Update, Save & Notify
        if (!mapLimit_error) {
          scan.processed.push(scan.found.pop());
          fs.writeFileSync('./scanfile.json', JSON.stringify(scan));
          console.log('Done!');
        }

        //Make backup if necessary
        counter++;
        if (counter % 100 === 0) {
          try {
            fs.copyFileSync('./scanfile.json', './scanfile.json.bak' + (Date.now()));
          } catch (ex) {
            return processDirectory_callback(ex);
          }
        }

        //Report to async
        processDirectory_callback(mapLimit_error);
      }
    );
  });
}
