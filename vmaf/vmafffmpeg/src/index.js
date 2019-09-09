//https://www.robinwieruch.de/minimal-node-js-babel-setup
//great node tutorial
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import uuidv4 from 'uuid/v4';
const pug = require('pug');
//bull for queuing the vmaf ffmpeg jons
var Queue = require('bull');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine','pug');
app.use(express.static('public/'));

//read files
var fs = require('fs');
var path = "../tests/"
var parsedTotalJson="";
let test= {};
const spawn = require('child_process').spawn;

//create the video queue
//queue allows 2 jobs at a time
const videoQualityQueue = new Queue('ffmpeg-processing-qualityMetrics', {
  limiter: {
    max: 1, 
    duration: 1000
  }
});

const concurrency = 1;
videoQualityQueue.process(concurrency, function(job, done) {
    var jobString = JSON.stringify(job);
    var file = "test_" +job.data.fileID+ ".json";
    console.log(path+file);
    var ffmpegPromise = new Promise(function(resolve, reject) {
         try {
    		let ffmpeg = spawn('ffmpeg', ['-i', job.data.testUrl, '-i', job.data.refUrl, '-filter_complex', '[0:v]scale='+job.data.refVideoWidth+'x'+job.data.refVideoHeight+':flags=bicubic[main];[main][1:v]libvmaf=ssim=true:psnr=true:phone_model=true:log_fmt=json:log_path='+path+file, `-f`, 'null', '-']);
    		console.log("running test id:" +job.data.fileID); 
    		ffmpeg.stderr.on('data', (err) => {
            	console.log('err:', new String(err));
            	
    		});
    		ffmpeg.stdout.on('data', function(){ 
    				console.log('stdout');
    				resolve("success!");
    				
    		 }); 
    	  }
    	  catch (Exception){ 
    			reject("error in promise");
    	  }
    	
    });
    return ffmpegPromise.then(function(successMessage){
    		console.log(successMessage);
    		done();
    		
    });
});

app.get('/',  (req, res) => {
     return res.render('landing');
});

app.get('/test', (req, res) => {
    //get urls
    //i exect 2 params reference url ref, test url test
    let ref = req.query.refurl;
    let test = req.query.testurl;
    let api =false;
    
    if (req.query.api == "false" ){
       api = false;
    }else if (req.query.api == "true" ){
     	api = true;
    }
    let testPriority = 5;
    if (req.query.pri !== {}){
      testPriority = req.query.pri;
    }

    //console.log("api: " +api);
    //create unique ID
    const id = uuidv4();
    
    //get ffprobe format data of both files, and then run the vmaf comparison 
    var totalJson = "";
    var jsonCombinedPromise = new Promise(function(resolve, reject) {
  	      
  	    try{  
  	      ffprobe(ref, function(refresult) { 
    		ffprobe(test, function(testresult) {
    			//create combined JSON file
    			var combinedJson = "{\"test\":"+ testresult+",\"reference\":"+refresult+"}"
    			resolve(combinedJson);
    		});
           });
          } 
          catch(Exception){
          	reject("error in ffprobe promise");
          }   
});
//todo promise rejections need to be added


jsonCombinedPromise.then(function(value) {
  totalJson = value;
//  console.log("total json promise:"+ totalJson);
   //compare the 2 videos
   //no longer have to be the same size!!!
   parsedTotalJson = JSON.parse(totalJson);
   var streamCount = parsedTotalJson['reference']['streams'].length;
   var refWidth=0;
   var refHeight = 0;
   for(var i=0;i<streamCount;i++){
   		if (parsedTotalJson['reference']['streams'][i]['codec_type'] =="video"){
   		   refWidth = parsedTotalJson['reference']['streams'][i]['width'];
   			refHeight =parsedTotalJson['reference']['streams'][i]['height'];
   		}
   
   } 
   
   //console.log('ref video is (hxw):'+refHeight+refWidth);
   //add video to the queue for quality scoring
  
   const job = videoQualityQueue.add({
     fileID: id,
     testUrl: test, 
     refUrl: ref,
     refVideoHeight: refHeight,
     refVideoWidth: refWidth
   },{priority: testPriority});
   

    totalJson = JSON.parse(totalJson);
    var statusCode = 100;
    if (api===true){

    	const response = {
      		id, statusCode, totalJson
    	};
    	//send a 100 meaning that the test is in process
   		return res.status(200).send(response);
   	} else{
   		 //build a page 		 
   		 return res.render('index', {
  			id, statusCode, totalJson
		 });
   		 
   		 }
  
});
 
  


});

app.get('/testResults', (req, res) => {
  //i expect to get the uuid that corresponds to afilename
  let id = req.query.id;
      let api =false;
    if (req.query.api == "false" ){
       api = false;
    }else if (req.query.api == "true" ){
     	api = true;
    }
  //get the data that is stored on the server
  //quality data
  let filename = "test_" +id+ ".json";
  var result;
  try {
  result = fs.readFileSync(path +filename, 'utf8');
} catch (err) {
     // no file found - not ready yet
     var inProgress = JSON.parse("{\"statusCode\": 101, \"status\": \"Still processing. Try Again in a few minutes.\"}");
     return res.status(200).send(inProgress);
}

  var json = JSON.parse(result);
  var videojson = JSON.stringify(parsedTotalJson);
 // console.log(videojson);
  var statusCode = 200;
  var VMAF = json['VMAF score'];
  var PSNR = json['PSNR score'];
  var SSIM = json['SSIM score'];
  var returnJson = "{\"VMAF\":"+json['VMAF score']+", \"PSNR\":"+json['PSNR score']+", \"SSIM\":"+json['SSIM score']+"}";
  returnJson = JSON.parse(returnJson);
  //console.log(returnJson);
  var statusCode = 200;
  if(api){
    const response = {
      id, statusCode,VMAF,PSNR,SSIM
     };
    return res.status(200).send(response);
  }else{
     //build a page 		 
     return res.render('results', {
  			id, statusCode,VMAF,PSNR,SSIM
	 });
   		 
  }
  
});


app.listen(process.env.PORT, () =>
  console.log(`Ready to process video files on port ${process.env.PORT}!`),
);


function ffprobe(videoUrl, callback){
	var dataString = "";
	let probe = spawn('ffprobe', ['-i', videoUrl, '-show_format','-show_streams', `-v`, 'quiet', '-print_format', 'json']);
    // console.log("ffprobe" + videoUrl);
     probe.stdout.on('data', (data) => {
      //  console.log("debugging DL" +data.length);     	
        dataString += data.toString();

 	});
 	probe.on('close', function(code) {
        return callback(dataString);
    });

}
