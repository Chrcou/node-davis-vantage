var EventEmitter = require("events");
var util = require("util");
const {SerialPort} = require("serialport");

var serialPortUsed = false;
var availablePorts = [];
var constructor;
var timer;
var deviceAwake = false;

var parsePacket = require("./lib/parsePacket");
var debug = require("./lib/debug");
var config = require("./config/config.json");

function DavisReader(options) {
  if (typeof options !== "object") {
    options = {};
  }

  debug.setDebugMode(options.debug);

  constructor = this;

  EventEmitter.call(this);

  // Either force a specific port or automatically discover it
  if (options && options.serialPort) {
    availablePorts[0] = options.serialPort;
    _setupSerialConnection();
  } else {
    SerialPort.list(function (err, ports) {
      if (err) {
        throw new Error("Serialports could not be listed: " + err);
      }

      debug.logAvailablePorts(ports);

      for (var i = 0; i < ports.length; i++) {
        availablePorts[i] = ports[i].comName;
      }

      _setupSerialConnection();
    });
  }
}

util.inherits(DavisReader, EventEmitter);

/**
 * Retrieve the name of the serial port being used
 */
DavisReader.prototype.getSerialPort = function () {
  return serialPortUsed;
};

module.exports = DavisReader;

/**
 * Setup serial port connection
 */
function _setupSerialConnection() {
  var port = availablePorts[0];
  let data64;
  let data36;
  debug.log("Trying to connect to Davis VUE via port: " + port);

  // Open serial port connection
  var sp = new SerialPort({path:port, ...config.serialPort});

  var received = "";

  sp.on("open", function () {
    debug.log("Serial connection established, waking up device.");
    sp.write("\n", function (err) {
      if (err) {
        return constructor.emit("Error on write: ", err.message);
      }
    });

    sp.on("data", function (data) {
      if (!deviceAwake) {
        if (data.toString() === "\n\r") {
          debug.log("Device is awake");
          serialPortUsed = port;
          constructor.emit("connected", port);

          sp.write("LOOP 1\n");
          return;
        }
      }
      debug.log("Received data, length:" + data.length);

      if (data.length < 66) {
        if (data.length === 64) {
          data64 = data;
        }
        if (data.length === 36) {
          data36 = data;
        }
        if ((data64 ?? []).length === 64 && (data36 ?? []).length === 36) {
          var arr = [data64, data36];

          var buf = Buffer.concat(arr);
          data = buf;
          console.log("assemblée");
          console.log(data);
          
        }
      }
      if (data.length == 100) {
        // remove ack
        data = data.slice(1);
      }
      try {
        var parsedData = parsePacket(data);
      } catch {
        var parsedData = null;
      }
      constructor.emit("data", parsedData);
      setTimeout(function () {
        sp.write("LOOP 1\n");
      }, 2000);
    });
  });

  sp.on("error", function (error) {
    constructor.emit("error", error);

    // Reject this port if we haven't found the correct port yet
    if (!serialPortUsed) {
      _tryNextSerialPort();
    }
  });

  sp.on("close", function () {
    deviceAwake = false;
    constructor.emit("close");
  });
}
