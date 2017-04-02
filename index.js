const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const app = express();
const token = process.env.FB_VERIFY_TOKEN;
const access = process.env.FB_ACCESS_TOKEN;
const STRING_REGISTER = "Para poder registarse necesita enviarnos el mensaje: \
                     quieropuntos DNI"

var User = require("./models/user").User;


app.set('port',(process.env.PORT || 5000));

app.use(bodyParser.urlencoded({extended : false}));

app.use(bodyParser.json());

app.get('/', function(req, res) {
    res.send('Hello World!')
});

app.get('/webhook', function(req, res) {
    if(req.query['hub.verify_token'] === token) {
        res.send(req.query['hub.challenge'])
    }
    res.send('No entry')
});

/*
    This address is necessary for facebook
    Facebook send a event through its webhook
*/

app.post('/webhook', function(req, res) {
    var data = req.body;
    // Make sure this is a page subscription
    if(data.object === 'page') {
        // Iterate over each entry - there may be multiple if batched
        data.entry.forEach(function(entry) {
            var pageID = entry.id;
            var timeOfEvent = entry.time;

            //Iterate over each messagin event
            entry.messaging.forEach(function(event) {
                if(event.message) {
                    receivedMessage(event);
                } else {
                    console.log("Webhook received unknown event: ", event);
                }
            });
        });
        // Assume all went well
        // I send to facebook a 200, to know to facebook
        // we have successfully received the callback
        res.sendStatus(200);
    }
});

/*
    Config the listen port
*/
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
});

// Functions 

/*
    When the message from Facebook is received
*/

function receivedMessage(event) {
    var senderID = event.sender.id;
    var message = event.message;

    var messageText = message.text.toLowerCase();
    var stringRegister = 'registr';

    if(messageText) {

        // -- TO RESPONSE QUESTION ABOUT REGISTER -- 

        // Case the string contain the string "stringRegister"
        if(messageText.indexOf(stringRegister) >= 0) {
            sendTextMessage(senderID, STRING_REGISTER);
        }

        switch(messageText) {
            case 'puntos':
                // -- TO ASK POINTS 
                getPointsUser(senderID);
                break;
            case 'si':
                // TO CONFIMATION ON QUIT POINTS
                updateStatusQuitPoints(senderID, 1);
                break;
            default:
        }

        // -- HERE DEPENDS IF THE CELLPHONE HAS PERMISIONS

        // GIVE ,QUIT OR CORRECT POINTS
        // Analize if the message is for give or quit points
        var messageSplit = messageText.split(' ');
        // TO REGISTER
        var checkDniUser = /^\d+$/.test(messageSplit[1]);
        if(messageSplit.length == 2 && messageSplit[0] === 'quieropuntos' && checkDniUser && messageSplit[1].length == 8) {
            var idRegister = saveRegister(senderID, 0, messageSplit[1]);
        }

        var correct = 0;
        if(messageSplit.length == 3 && messageSplit[2] === 'c') {
            correct = 1;
        }

        if(messageSplit.length == 2 || messageSplit.length == 3) {
            if(messageSplit[1].indexOf('+') == 0) {
                checkAndGivePoints('+', messageSplit, correct, senderID);
            }

            if(messageSplit[1].indexOf('-') == 0) {
                checkAndGivePoints('-', messageSplit, correct, senderID);
            }
        } 
        
    }
}

/*
    To check the points and give the points
    Input:
        - operation(String): + or - to operate in the points
        - messageSplit(Array-String): Array string with the components DNI and points
        - correct(Integer): To know if is necessary to notify to the customer when 
                            its points are discounted.
        - senderID(String): Facebook ID Who sent the message.
    Return: 
        Nothing
*/

function checkAndGivePoints(operation, messageSplit, correct, senderID) {

    messageSplit[1] = messageSplit[1].replace(operation,'');
    var checkDniUser = /^\d+$/.test(messageSplit[0]);
    var checkPoints = /^\d+$/.test(messageSplit[1]);
    // Now we can give points
    if(checkDniUser && checkPoints) {
        // First check if the idFacebbok have permissions
        checkPermission(senderID, messageSplit[0], messageSplit[1], operation, correct);
    }

}

/*
    Get he status for discount the points (Aync function - Has more processes)
    Input:
        - idFacebook(Integer): Facebook ID of a user 
        - senderID(String): Facebook ID Who sent the message.
        - points(String): Points to discount to the customer
        - pointsUser(Integer): Current points of the customer
    Return:
        Nothing
*/

function getStatusQuitPoints(idFacebook, senderID, points, pointsUser) {
    User.findOne({idFacebook:idFacebook},"statusQuit", function(err, doc) {
        var statusQuit= doc.statusQuit;

        var amountPoints = pointsUser - parseInt(points);
        // In case the user not have sufficient points.
        if(amountPoints < 0) {
            sendTextMessage(senderID,"Insuficientes puntos: " + pointsUser);
            return;
        }

        if(!statusQuit) {

            sendTextMessage(idFacebook, "Confirmar descuento de " +  points + " puntos, con la palabra: Si");
            sendTextMessage(senderID, "Esperando confirmacion del cliente, una vez le diga que confirmo, repita mensaje");
        } else {
            givePoints(amountPoints, idFacebook);
            sendTextMessage(idFacebook, "Felicitaciones canjeado sus puntos");
            sendTextMessage(senderID, "El cliente confirmo el descuento de " +  points + " puntos");
            updateStatusQuitPoints(idFacebook, 0);
        }
    });
}

/*
    Update the status to discount points to the customer
    Inputs:
        - idFacebook(Integer): Facebook ID of the customer
        - statusQuit(Integer): Permission given by the client for discounting its points 0: not, 1: yes
    Output: 
        Nothing
*/
function updateStatusQuitPoints(idFacebook, statusQuit) {
    User.update({idFacebook:idFacebook},{$set:{statusQuit:statusQuit}}, function(err, doc) {
    });
}

/*
    Save in database mongodb
    Input:
        - recipientId(Integer): Facebook ID Who sent the message.
        - permiss(Integer): level of permission 0 : register and read point, 1: give, discount and correct points
        - dniUser(String): dni of user
    Output: Nothing 
*/
function saveRegister(recipientId, permiss, dniUser) {
    
    var user = new User({
                            idFacebook: recipientId, 
                            dni: dniUser,
                            points: 0, 
                            permission: permiss, 
                            statusQuit: 0
                        });
    // Using promises (TODO Warning!!: Heroku console said me this is deprecated)
    user.save().then(function(us){
        console.log("Guardado User correctamente" );
        sendTextMessage(recipientId, "Registro exitoso!");
    }, function(err){
        if(err) {
            console.log("Error al Guardar User: " + String(err));
            sendTextMessage(recipientId, "Error al registrarse");
        }
    })

}

/*
    Get the count of points (Aync function - Has more processes)
    Inputs:
        - idFacebook(Integer): Facebook ID of the customer
        - operation(String): + or - , to apply to the points
        - points(String): points to apply  the "operation"
        - senderID(String): Facebook ID Who sent the message.
        - correct(integer): To know if is necessary to notify to the customer when 
                    its points are discounted.
    outputs: 
        Nothing

*/
function getPoints(idFacebook, operation, points, senderID, correct) {
    User.findOne({idFacebook:idFacebook},"points", function(err, doc) {
        var pointsUser = doc.points;
        var amountPoints = 0;

        if(correct) {
            if(operation === '+') {
                amountPoints = pointsUser + parseInt(points);
            } else {
                amountPoints = pointsUser - parseInt(points);
            }
            givePoints(amountPoints, idFacebook);
            sendTextMessage(senderID,"Corregido!");
        }
        else {
            if(operation === '+') {
                amountPoints = pointsUser + parseInt(points);
                givePoints(amountPoints, idFacebook);
                sendTextMessage(idFacebook, "Felicitaciones ha ganado " + points + 
                    " puntos, tiene acumulado " + amountPoints + " puntos");
            } else {
                getStatusQuitPoints(idFacebook, senderID, points, pointsUser);
            }
        }

    });
}

/*
    Get the amounts of points of a specific customer
    Inputs:
        - recipientId(Integer): Facebook ID of the customer
    outputs: 
        Nothing

*/
function getPointsUser(recipientId) {
    User.findOne({idFacebook:recipientId},"points",function(err, doc) {
        if(!err) {
            sendTextMessage(recipientId, "Usted tiene: " + doc.points + " puntos");
        }
    });
}

/*
    Update the amount of points of the customer
    Inputs:
        - amountPoints(Integer): The amount of points to update
        - recipientId(Intenger): Facebook ID of the customer
    outputs: 
        Nothing

*/
function givePoints(amountPoints, recipientId) {
    // changue for sentence to insert TODO
    User.update({idFacebook:recipientId},{$set:{points:amountPoints}},function(err, doc) {
        if(err) {
            sendTextMessage(senderID,"Error al guardar, usuario no existe");
        }
    });
}
/*
    Get the id of facebook the the customer
    Input:
        - dni(String): DNI of the customer
        - points(String): points to apply  the "operation"
        - senderID(Integer): Facebook ID Who sent the message.
        - operation(String): + or - , to apply to the points        
        - correct(Integer): To know if is necessary to notify to the customer when 
                    its points are discounted.
    Output: 
        Nothing

*/
function getIdFacebook(dni, points, senderID, operation, correct) {
    User.findOne({dni:dni},"idFacebook", function(err, doc) {
        var idFacebook = doc.idFacebook;

        getPoints(idFacebook, operation, points, senderID, correct); 
    });
}

/*
    Get the permission of the user
    Inputs:
        - recipientId(Integer): Facebook ID of the customer
        - dni(String): DNI of the customer
        - points(String): points to apply  the "operation"
        - operation(String): + or - , to apply to the points        
        - correct(Integer): To know if is necessary to notify to the customer when 
                    its points are discounted.
    outputs: 
        Nothing

*/

function checkPermission(recipientId, dni, points, operation, correct) {
    User.findOne({idFacebook:recipientId},"permission", function(err, doc) {
        if(doc.permission) {
                getIdFacebook(dni, points, recipientId, operation, correct);
            }
    });
    
}

/*
    Send the message to the customer
    Inputs:
        - recipientId(Integer): Facebook ID of the customer
        - messageText(String): Message to send
    Return
        Nothing
*/

function sendTextMessage(recipientId, messageText) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: messageText
        }
    };
    callSendAPI(messageData);
}

/*
    Call the API of Facebook to send the message "messageData"
*/

function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: access},
        method: 'POST',
        json: messageData
    }, function(error, response, body) {
        if(!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;
            console.log("Successfully sent generic message with id %s to recipient %s",
                messageId, recipientId);
        } else {
            console.error("Unable to send message");
            console.error(response);
            console.error(error);
        }
    });

}
