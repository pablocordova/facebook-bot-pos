
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

//mongoose.connect("mongodb://localhost/smartketing");
mongoose.connect("mongodb://pablo:123@ds133328.mlab.com:33328/smartketingdb");


var user_schema = new Schema({
	idFacebook : Number,
	dni: String,
	points: Number,
	permission : Number,
	statusQuit: Number
});

var User = mongoose.model("User", user_schema);

module.exports.User = User;
