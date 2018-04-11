# pngout-batch-processor-for-mangadex
Processes a directory containing many directories full of images

## Notes
Do make sure that the directory you pass as argument only contains other directories.  
This requirement is due to the fact, that all content of the directory is searched for and no additional filtering  
for files is done.  
The application will create a file called `scandb.sqlite3` and backup it every time the application  
starts or after 100 chapters were processed.  
Even if a scan-database is found, you will need to pass it the directory of the chapters.  
If the queue is empty, the passed directory will be scanned, already processed chapter-directories will be filtered out.  
Make sure to **BACKUP EVERYTHING** ***BEFORE*** you start the process.

## Usage
(1) Make sure node is installed  
(2) Execute `npm i`  
(3) Download the binary of pngout  
(4) Save pngout under the filename `pngout`  
(5) Make sure enough space is available and it has write-permissions to `./`  
(6) Start the process with `node index "PATH_TO_FOLDER"`  
(7) Let it do it's thing  
(8) Ctrl+C if you want to stop  
(9) Simple execute `node index "PATH_TO_FOLDER"` again to resume
