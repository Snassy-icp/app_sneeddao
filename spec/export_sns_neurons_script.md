"use strict";
var yolosns = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod2) => function __require() {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
    mod2
  ));
  var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);

  // node_modules/base64-js/index.js
  var require_base64_js = __commonJS({
    "node_modules/base64-js/index.js"(exports) {
      "use strict";
      exports.byteLength = byteLength;
      exports.toByteArray = toByteArray;
      exports.fromByteArray = fromByteArray;
      var lookup = [];
      var revLookup = [];
      var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
      var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      for (i = 0, len = code.length; i < len; ++i) {
        lookup[i] = code[i];
        revLookup[code.charCodeAt(i)] = i;
      }
      var i;
      var len;
      revLookup["-".charCodeAt(0)] = 62;
      revLookup["_".charCodeAt(0)] = 63;
      function getLens(b64) {
        var len2 = b64.length;
        if (len2 % 4 > 0) {
          throw new Error("Invalid string. Length must be a multiple of 4");
        }
        var validLen = b64.indexOf("=");
        if (validLen === -1)
          validLen = len2;
        var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
        return [validLen, placeHoldersLen];
      }
      function byteLength(b64) {
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function _byteLength(b64, validLen, placeHoldersLen) {
        return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
      }
      function toByteArray(b64) {
        var tmp;
        var lens = getLens(b64);
        var validLen = lens[0];
        var placeHoldersLen = lens[1];
        var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
        var curByte = 0;
        var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
        var i2;
        for (i2 = 0; i2 < len2; i2 += 4) {
          tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
          arr[curByte++] = tmp >> 16 & 255;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 2) {
          tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
          arr[curByte++] = tmp & 255;
        }
        if (placeHoldersLen === 1) {
          tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
          arr[curByte++] = tmp >> 8 & 255;
          arr[curByte++] = tmp & 255;
        }
        return arr;
      }
      function tripletToBase64(num) {
        return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
      }
      function encodeChunk(uint8, start, end) {
        var tmp;
        var output = [];
        for (var i2 = start; i2 < end; i2 += 3) {
          tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
          output.push(tripletToBase64(tmp));
        }
        return output.join("");
      }
      function fromByteArray(uint8) {
        var tmp;
        var len2 = uint8.length;
        var extraBytes = len2 % 3;
        var parts = [];
        var maxChunkLength = 16383;
        for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
          parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
        }
        if (extraBytes === 1) {
          tmp = uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
          );
        } else if (extraBytes === 2) {
          tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
          parts.push(
            lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
          );
        }
        return parts.join("");
      }
    }
  });

  // node_modules/ieee754/index.js
  var require_ieee754 = __commonJS({
    "node_modules/ieee754/index.js"(exports) {
      exports.read = function(buffer, offset, isLE, mLen, nBytes) {
        var e3, m3;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var nBits = -7;
        var i = isLE ? nBytes - 1 : 0;
        var d2 = isLE ? -1 : 1;
        var s2 = buffer[offset + i];
        i += d2;
        e3 = s2 & (1 << -nBits) - 1;
        s2 >>= -nBits;
        nBits += eLen;
        for (; nBits > 0; e3 = e3 * 256 + buffer[offset + i], i += d2, nBits -= 8) {
        }
        m3 = e3 & (1 << -nBits) - 1;
        e3 >>= -nBits;
        nBits += mLen;
        for (; nBits > 0; m3 = m3 * 256 + buffer[offset + i], i += d2, nBits -= 8) {
        }
        if (e3 === 0) {
          e3 = 1 - eBias;
        } else if (e3 === eMax) {
          return m3 ? NaN : (s2 ? -1 : 1) * Infinity;
        } else {
          m3 = m3 + Math.pow(2, mLen);
          e3 = e3 - eBias;
        }
        return (s2 ? -1 : 1) * m3 * Math.pow(2, e3 - mLen);
      };
      exports.write = function(buffer, value4, offset, isLE, mLen, nBytes) {
        var e3, m3, c3;
        var eLen = nBytes * 8 - mLen - 1;
        var eMax = (1 << eLen) - 1;
        var eBias = eMax >> 1;
        var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
        var i = isLE ? 0 : nBytes - 1;
        var d2 = isLE ? 1 : -1;
        var s2 = value4 < 0 || value4 === 0 && 1 / value4 < 0 ? 1 : 0;
        value4 = Math.abs(value4);
        if (isNaN(value4) || value4 === Infinity) {
          m3 = isNaN(value4) ? 1 : 0;
          e3 = eMax;
        } else {
          e3 = Math.floor(Math.log(value4) / Math.LN2);
          if (value4 * (c3 = Math.pow(2, -e3)) < 1) {
            e3--;
            c3 *= 2;
          }
          if (e3 + eBias >= 1) {
            value4 += rt / c3;
          } else {
            value4 += rt * Math.pow(2, 1 - eBias);
          }
          if (value4 * c3 >= 2) {
            e3++;
            c3 /= 2;
          }
          if (e3 + eBias >= eMax) {
            m3 = 0;
            e3 = eMax;
          } else if (e3 + eBias >= 1) {
            m3 = (value4 * c3 - 1) * Math.pow(2, mLen);
            e3 = e3 + eBias;
          } else {
            m3 = value4 * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e3 = 0;
          }
        }
        for (; mLen >= 8; buffer[offset + i] = m3 & 255, i += d2, m3 /= 256, mLen -= 8) {
        }
        e3 = e3 << mLen | m3;
        eLen += mLen;
        for (; eLen > 0; buffer[offset + i] = e3 & 255, i += d2, e3 /= 256, eLen -= 8) {
        }
        buffer[offset + i - d2] |= s2 * 128;
      };
    }
  });

  // node_modules/buffer/index.js
  var require_buffer = __commonJS({
    "node_modules/buffer/index.js"(exports) {
      "use strict";
      var base64 = require_base64_js();
      var ieee754 = require_ieee754();
      var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
      exports.Buffer = Buffer3;
      exports.SlowBuffer = SlowBuffer;
      exports.INSPECT_MAX_BYTES = 50;
      var K_MAX_LENGTH = 2147483647;
      exports.kMaxLength = K_MAX_LENGTH;
      Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
      if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
        console.error(
          "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
        );
      }
      function typedArraySupport() {
        try {
          const arr = new Uint8Array(1);
          const proto = { foo: function() {
            return 42;
          } };
          Object.setPrototypeOf(proto, Uint8Array.prototype);
          Object.setPrototypeOf(arr, proto);
          return arr.foo() === 42;
        } catch (e3) {
          return false;
        }
      }
      Object.defineProperty(Buffer3.prototype, "parent", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this))
            return void 0;
          return this.buffer;
        }
      });
      Object.defineProperty(Buffer3.prototype, "offset", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this))
            return void 0;
          return this.byteOffset;
        }
      });
      function createBuffer(length) {
        if (length > K_MAX_LENGTH) {
          throw new RangeError('The value "' + length + '" is invalid for option "size"');
        }
        const buf = new Uint8Array(length);
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function Buffer3(arg, encodingOrOffset, length) {
        if (typeof arg === "number") {
          if (typeof encodingOrOffset === "string") {
            throw new TypeError(
              'The "string" argument must be of type string. Received type number'
            );
          }
          return allocUnsafe(arg);
        }
        return from(arg, encodingOrOffset, length);
      }
      Buffer3.poolSize = 8192;
      function from(value4, encodingOrOffset, length) {
        if (typeof value4 === "string") {
          return fromString(value4, encodingOrOffset);
        }
        if (ArrayBuffer.isView(value4)) {
          return fromArrayView(value4);
        }
        if (value4 == null) {
          throw new TypeError(
            "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value4
          );
        }
        if (isInstance(value4, ArrayBuffer) || value4 && isInstance(value4.buffer, ArrayBuffer)) {
          return fromArrayBuffer(value4, encodingOrOffset, length);
        }
        if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value4, SharedArrayBuffer) || value4 && isInstance(value4.buffer, SharedArrayBuffer))) {
          return fromArrayBuffer(value4, encodingOrOffset, length);
        }
        if (typeof value4 === "number") {
          throw new TypeError(
            'The "value" argument must not be of type number. Received type number'
          );
        }
        const valueOf = value4.valueOf && value4.valueOf();
        if (valueOf != null && valueOf !== value4) {
          return Buffer3.from(valueOf, encodingOrOffset, length);
        }
        const b3 = fromObject(value4);
        if (b3)
          return b3;
        if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value4[Symbol.toPrimitive] === "function") {
          return Buffer3.from(value4[Symbol.toPrimitive]("string"), encodingOrOffset, length);
        }
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value4
        );
      }
      Buffer3.from = function(value4, encodingOrOffset, length) {
        return from(value4, encodingOrOffset, length);
      };
      Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
      Object.setPrototypeOf(Buffer3, Uint8Array);
      function assertSize(size) {
        if (typeof size !== "number") {
          throw new TypeError('"size" argument must be of type number');
        } else if (size < 0) {
          throw new RangeError('The value "' + size + '" is invalid for option "size"');
        }
      }
      function alloc(size, fill, encoding) {
        assertSize(size);
        if (size <= 0) {
          return createBuffer(size);
        }
        if (fill !== void 0) {
          return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
        }
        return createBuffer(size);
      }
      Buffer3.alloc = function(size, fill, encoding) {
        return alloc(size, fill, encoding);
      };
      function allocUnsafe(size) {
        assertSize(size);
        return createBuffer(size < 0 ? 0 : checked(size) | 0);
      }
      Buffer3.allocUnsafe = function(size) {
        return allocUnsafe(size);
      };
      Buffer3.allocUnsafeSlow = function(size) {
        return allocUnsafe(size);
      };
      function fromString(string, encoding) {
        if (typeof encoding !== "string" || encoding === "") {
          encoding = "utf8";
        }
        if (!Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        const length = byteLength(string, encoding) | 0;
        let buf = createBuffer(length);
        const actual = buf.write(string, encoding);
        if (actual !== length) {
          buf = buf.slice(0, actual);
        }
        return buf;
      }
      function fromArrayLike(array) {
        const length = array.length < 0 ? 0 : checked(array.length) | 0;
        const buf = createBuffer(length);
        for (let i = 0; i < length; i += 1) {
          buf[i] = array[i] & 255;
        }
        return buf;
      }
      function fromArrayView(arrayView) {
        if (isInstance(arrayView, Uint8Array)) {
          const copy = new Uint8Array(arrayView);
          return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
        }
        return fromArrayLike(arrayView);
      }
      function fromArrayBuffer(array, byteOffset, length) {
        if (byteOffset < 0 || array.byteLength < byteOffset) {
          throw new RangeError('"offset" is outside of buffer bounds');
        }
        if (array.byteLength < byteOffset + (length || 0)) {
          throw new RangeError('"length" is outside of buffer bounds');
        }
        let buf;
        if (byteOffset === void 0 && length === void 0) {
          buf = new Uint8Array(array);
        } else if (length === void 0) {
          buf = new Uint8Array(array, byteOffset);
        } else {
          buf = new Uint8Array(array, byteOffset, length);
        }
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function fromObject(obj) {
        if (Buffer3.isBuffer(obj)) {
          const len = checked(obj.length) | 0;
          const buf = createBuffer(len);
          if (buf.length === 0) {
            return buf;
          }
          obj.copy(buf, 0, 0, len);
          return buf;
        }
        if (obj.length !== void 0) {
          if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
            return createBuffer(0);
          }
          return fromArrayLike(obj);
        }
        if (obj.type === "Buffer" && Array.isArray(obj.data)) {
          return fromArrayLike(obj.data);
        }
      }
      function checked(length) {
        if (length >= K_MAX_LENGTH) {
          throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
        }
        return length | 0;
      }
      function SlowBuffer(length) {
        if (+length != length) {
          length = 0;
        }
        return Buffer3.alloc(+length);
      }
      Buffer3.isBuffer = function isBuffer(b3) {
        return b3 != null && b3._isBuffer === true && b3 !== Buffer3.prototype;
      };
      Buffer3.compare = function compare2(a, b3) {
        if (isInstance(a, Uint8Array))
          a = Buffer3.from(a, a.offset, a.byteLength);
        if (isInstance(b3, Uint8Array))
          b3 = Buffer3.from(b3, b3.offset, b3.byteLength);
        if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b3)) {
          throw new TypeError(
            'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
          );
        }
        if (a === b3)
          return 0;
        let x5 = a.length;
        let y = b3.length;
        for (let i = 0, len = Math.min(x5, y); i < len; ++i) {
          if (a[i] !== b3[i]) {
            x5 = a[i];
            y = b3[i];
            break;
          }
        }
        if (x5 < y)
          return -1;
        if (y < x5)
          return 1;
        return 0;
      };
      Buffer3.isEncoding = function isEncoding(encoding) {
        switch (String(encoding).toLowerCase()) {
          case "hex":
          case "utf8":
          case "utf-8":
          case "ascii":
          case "latin1":
          case "binary":
          case "base64":
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return true;
          default:
            return false;
        }
      };
      Buffer3.concat = function concat3(list, length) {
        if (!Array.isArray(list)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        }
        if (list.length === 0) {
          return Buffer3.alloc(0);
        }
        let i;
        if (length === void 0) {
          length = 0;
          for (i = 0; i < list.length; ++i) {
            length += list[i].length;
          }
        }
        const buffer = Buffer3.allocUnsafe(length);
        let pos = 0;
        for (i = 0; i < list.length; ++i) {
          let buf = list[i];
          if (isInstance(buf, Uint8Array)) {
            if (pos + buf.length > buffer.length) {
              if (!Buffer3.isBuffer(buf))
                buf = Buffer3.from(buf);
              buf.copy(buffer, pos);
            } else {
              Uint8Array.prototype.set.call(
                buffer,
                buf,
                pos
              );
            }
          } else if (!Buffer3.isBuffer(buf)) {
            throw new TypeError('"list" argument must be an Array of Buffers');
          } else {
            buf.copy(buffer, pos);
          }
          pos += buf.length;
        }
        return buffer;
      };
      function byteLength(string, encoding) {
        if (Buffer3.isBuffer(string)) {
          return string.length;
        }
        if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
          return string.byteLength;
        }
        if (typeof string !== "string") {
          throw new TypeError(
            'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
          );
        }
        const len = string.length;
        const mustMatch = arguments.length > 2 && arguments[2] === true;
        if (!mustMatch && len === 0)
          return 0;
        let loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "ascii":
            case "latin1":
            case "binary":
              return len;
            case "utf8":
            case "utf-8":
              return utf8ToBytes3(string).length;
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return len * 2;
            case "hex":
              return len >>> 1;
            case "base64":
              return base64ToBytes(string).length;
            default:
              if (loweredCase) {
                return mustMatch ? -1 : utf8ToBytes3(string).length;
              }
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.byteLength = byteLength;
      function slowToString(encoding, start, end) {
        let loweredCase = false;
        if (start === void 0 || start < 0) {
          start = 0;
        }
        if (start > this.length) {
          return "";
        }
        if (end === void 0 || end > this.length) {
          end = this.length;
        }
        if (end <= 0) {
          return "";
        }
        end >>>= 0;
        start >>>= 0;
        if (end <= start) {
          return "";
        }
        if (!encoding)
          encoding = "utf8";
        while (true) {
          switch (encoding) {
            case "hex":
              return hexSlice(this, start, end);
            case "utf8":
            case "utf-8":
              return utf8Slice(this, start, end);
            case "ascii":
              return asciiSlice(this, start, end);
            case "latin1":
            case "binary":
              return latin1Slice(this, start, end);
            case "base64":
              return base64Slice(this, start, end);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return utf16leSlice(this, start, end);
            default:
              if (loweredCase)
                throw new TypeError("Unknown encoding: " + encoding);
              encoding = (encoding + "").toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.prototype._isBuffer = true;
      function swap(b3, n2, m3) {
        const i = b3[n2];
        b3[n2] = b3[m3];
        b3[m3] = i;
      }
      Buffer3.prototype.swap16 = function swap16() {
        const len = this.length;
        if (len % 2 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 16-bits");
        }
        for (let i = 0; i < len; i += 2) {
          swap(this, i, i + 1);
        }
        return this;
      };
      Buffer3.prototype.swap32 = function swap32() {
        const len = this.length;
        if (len % 4 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 32-bits");
        }
        for (let i = 0; i < len; i += 4) {
          swap(this, i, i + 3);
          swap(this, i + 1, i + 2);
        }
        return this;
      };
      Buffer3.prototype.swap64 = function swap64() {
        const len = this.length;
        if (len % 8 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 64-bits");
        }
        for (let i = 0; i < len; i += 8) {
          swap(this, i, i + 7);
          swap(this, i + 1, i + 6);
          swap(this, i + 2, i + 5);
          swap(this, i + 3, i + 4);
        }
        return this;
      };
      Buffer3.prototype.toString = function toString() {
        const length = this.length;
        if (length === 0)
          return "";
        if (arguments.length === 0)
          return utf8Slice(this, 0, length);
        return slowToString.apply(this, arguments);
      };
      Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
      Buffer3.prototype.equals = function equals(b3) {
        if (!Buffer3.isBuffer(b3))
          throw new TypeError("Argument must be a Buffer");
        if (this === b3)
          return true;
        return Buffer3.compare(this, b3) === 0;
      };
      Buffer3.prototype.inspect = function inspect() {
        let str = "";
        const max = exports.INSPECT_MAX_BYTES;
        str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
        if (this.length > max)
          str += " ... ";
        return "<Buffer " + str + ">";
      };
      if (customInspectSymbol) {
        Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
      }
      Buffer3.prototype.compare = function compare2(target, start, end, thisStart, thisEnd) {
        if (isInstance(target, Uint8Array)) {
          target = Buffer3.from(target, target.offset, target.byteLength);
        }
        if (!Buffer3.isBuffer(target)) {
          throw new TypeError(
            'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
          );
        }
        if (start === void 0) {
          start = 0;
        }
        if (end === void 0) {
          end = target ? target.length : 0;
        }
        if (thisStart === void 0) {
          thisStart = 0;
        }
        if (thisEnd === void 0) {
          thisEnd = this.length;
        }
        if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
          throw new RangeError("out of range index");
        }
        if (thisStart >= thisEnd && start >= end) {
          return 0;
        }
        if (thisStart >= thisEnd) {
          return -1;
        }
        if (start >= end) {
          return 1;
        }
        start >>>= 0;
        end >>>= 0;
        thisStart >>>= 0;
        thisEnd >>>= 0;
        if (this === target)
          return 0;
        let x5 = thisEnd - thisStart;
        let y = end - start;
        const len = Math.min(x5, y);
        const thisCopy = this.slice(thisStart, thisEnd);
        const targetCopy = target.slice(start, end);
        for (let i = 0; i < len; ++i) {
          if (thisCopy[i] !== targetCopy[i]) {
            x5 = thisCopy[i];
            y = targetCopy[i];
            break;
          }
        }
        if (x5 < y)
          return -1;
        if (y < x5)
          return 1;
        return 0;
      };
      function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
        if (buffer.length === 0)
          return -1;
        if (typeof byteOffset === "string") {
          encoding = byteOffset;
          byteOffset = 0;
        } else if (byteOffset > 2147483647) {
          byteOffset = 2147483647;
        } else if (byteOffset < -2147483648) {
          byteOffset = -2147483648;
        }
        byteOffset = +byteOffset;
        if (numberIsNaN(byteOffset)) {
          byteOffset = dir ? 0 : buffer.length - 1;
        }
        if (byteOffset < 0)
          byteOffset = buffer.length + byteOffset;
        if (byteOffset >= buffer.length) {
          if (dir)
            return -1;
          else
            byteOffset = buffer.length - 1;
        } else if (byteOffset < 0) {
          if (dir)
            byteOffset = 0;
          else
            return -1;
        }
        if (typeof val === "string") {
          val = Buffer3.from(val, encoding);
        }
        if (Buffer3.isBuffer(val)) {
          if (val.length === 0) {
            return -1;
          }
          return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
        } else if (typeof val === "number") {
          val = val & 255;
          if (typeof Uint8Array.prototype.indexOf === "function") {
            if (dir) {
              return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
            } else {
              return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
            }
          }
          return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
        }
        throw new TypeError("val must be string, number or Buffer");
      }
      function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
        let indexSize = 1;
        let arrLength = arr.length;
        let valLength = val.length;
        if (encoding !== void 0) {
          encoding = String(encoding).toLowerCase();
          if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
            if (arr.length < 2 || val.length < 2) {
              return -1;
            }
            indexSize = 2;
            arrLength /= 2;
            valLength /= 2;
            byteOffset /= 2;
          }
        }
        function read(buf, i2) {
          if (indexSize === 1) {
            return buf[i2];
          } else {
            return buf.readUInt16BE(i2 * indexSize);
          }
        }
        let i;
        if (dir) {
          let foundIndex = -1;
          for (i = byteOffset; i < arrLength; i++) {
            if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
              if (foundIndex === -1)
                foundIndex = i;
              if (i - foundIndex + 1 === valLength)
                return foundIndex * indexSize;
            } else {
              if (foundIndex !== -1)
                i -= i - foundIndex;
              foundIndex = -1;
            }
          }
        } else {
          if (byteOffset + valLength > arrLength)
            byteOffset = arrLength - valLength;
          for (i = byteOffset; i >= 0; i--) {
            let found = true;
            for (let j2 = 0; j2 < valLength; j2++) {
              if (read(arr, i + j2) !== read(val, j2)) {
                found = false;
                break;
              }
            }
            if (found)
              return i;
          }
        }
        return -1;
      }
      Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
        return this.indexOf(val, byteOffset, encoding) !== -1;
      };
      Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
      };
      Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
      };
      function hexWrite(buf, string, offset, length) {
        offset = Number(offset) || 0;
        const remaining = buf.length - offset;
        if (!length) {
          length = remaining;
        } else {
          length = Number(length);
          if (length > remaining) {
            length = remaining;
          }
        }
        const strLen = string.length;
        if (length > strLen / 2) {
          length = strLen / 2;
        }
        let i;
        for (i = 0; i < length; ++i) {
          const parsed = parseInt(string.substr(i * 2, 2), 16);
          if (numberIsNaN(parsed))
            return i;
          buf[offset + i] = parsed;
        }
        return i;
      }
      function utf8Write(buf, string, offset, length) {
        return blitBuffer(utf8ToBytes3(string, buf.length - offset), buf, offset, length);
      }
      function asciiWrite(buf, string, offset, length) {
        return blitBuffer(asciiToBytes(string), buf, offset, length);
      }
      function base64Write(buf, string, offset, length) {
        return blitBuffer(base64ToBytes(string), buf, offset, length);
      }
      function ucs2Write(buf, string, offset, length) {
        return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
      }
      Buffer3.prototype.write = function write(string, offset, length, encoding) {
        if (offset === void 0) {
          encoding = "utf8";
          length = this.length;
          offset = 0;
        } else if (length === void 0 && typeof offset === "string") {
          encoding = offset;
          length = this.length;
          offset = 0;
        } else if (isFinite(offset)) {
          offset = offset >>> 0;
          if (isFinite(length)) {
            length = length >>> 0;
            if (encoding === void 0)
              encoding = "utf8";
          } else {
            encoding = length;
            length = void 0;
          }
        } else {
          throw new Error(
            "Buffer.write(string, encoding, offset[, length]) is no longer supported"
          );
        }
        const remaining = this.length - offset;
        if (length === void 0 || length > remaining)
          length = remaining;
        if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
          throw new RangeError("Attempt to write outside buffer bounds");
        }
        if (!encoding)
          encoding = "utf8";
        let loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "hex":
              return hexWrite(this, string, offset, length);
            case "utf8":
            case "utf-8":
              return utf8Write(this, string, offset, length);
            case "ascii":
            case "latin1":
            case "binary":
              return asciiWrite(this, string, offset, length);
            case "base64":
              return base64Write(this, string, offset, length);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return ucs2Write(this, string, offset, length);
            default:
              if (loweredCase)
                throw new TypeError("Unknown encoding: " + encoding);
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      };
      Buffer3.prototype.toJSON = function toJSON() {
        return {
          type: "Buffer",
          data: Array.prototype.slice.call(this._arr || this, 0)
        };
      };
      function base64Slice(buf, start, end) {
        if (start === 0 && end === buf.length) {
          return base64.fromByteArray(buf);
        } else {
          return base64.fromByteArray(buf.slice(start, end));
        }
      }
      function utf8Slice(buf, start, end) {
        end = Math.min(buf.length, end);
        const res = [];
        let i = start;
        while (i < end) {
          const firstByte = buf[i];
          let codePoint = null;
          let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
          if (i + bytesPerSequence <= end) {
            let secondByte, thirdByte, fourthByte, tempCodePoint;
            switch (bytesPerSequence) {
              case 1:
                if (firstByte < 128) {
                  codePoint = firstByte;
                }
                break;
              case 2:
                secondByte = buf[i + 1];
                if ((secondByte & 192) === 128) {
                  tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                  if (tempCodePoint > 127) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 3:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                  if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 4:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                fourthByte = buf[i + 3];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                  if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                    codePoint = tempCodePoint;
                  }
                }
            }
          }
          if (codePoint === null) {
            codePoint = 65533;
            bytesPerSequence = 1;
          } else if (codePoint > 65535) {
            codePoint -= 65536;
            res.push(codePoint >>> 10 & 1023 | 55296);
            codePoint = 56320 | codePoint & 1023;
          }
          res.push(codePoint);
          i += bytesPerSequence;
        }
        return decodeCodePointsArray(res);
      }
      var MAX_ARGUMENTS_LENGTH = 4096;
      function decodeCodePointsArray(codePoints) {
        const len = codePoints.length;
        if (len <= MAX_ARGUMENTS_LENGTH) {
          return String.fromCharCode.apply(String, codePoints);
        }
        let res = "";
        let i = 0;
        while (i < len) {
          res += String.fromCharCode.apply(
            String,
            codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
          );
        }
        return res;
      }
      function asciiSlice(buf, start, end) {
        let ret = "";
        end = Math.min(buf.length, end);
        for (let i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i] & 127);
        }
        return ret;
      }
      function latin1Slice(buf, start, end) {
        let ret = "";
        end = Math.min(buf.length, end);
        for (let i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i]);
        }
        return ret;
      }
      function hexSlice(buf, start, end) {
        const len = buf.length;
        if (!start || start < 0)
          start = 0;
        if (!end || end < 0 || end > len)
          end = len;
        let out = "";
        for (let i = start; i < end; ++i) {
          out += hexSliceLookupTable[buf[i]];
        }
        return out;
      }
      function utf16leSlice(buf, start, end) {
        const bytes = buf.slice(start, end);
        let res = "";
        for (let i = 0; i < bytes.length - 1; i += 2) {
          res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
        }
        return res;
      }
      Buffer3.prototype.slice = function slice(start, end) {
        const len = this.length;
        start = ~~start;
        end = end === void 0 ? len : ~~end;
        if (start < 0) {
          start += len;
          if (start < 0)
            start = 0;
        } else if (start > len) {
          start = len;
        }
        if (end < 0) {
          end += len;
          if (end < 0)
            end = 0;
        } else if (end > len) {
          end = len;
        }
        if (end < start)
          end = start;
        const newBuf = this.subarray(start, end);
        Object.setPrototypeOf(newBuf, Buffer3.prototype);
        return newBuf;
      };
      function checkOffset(offset, ext, length) {
        if (offset % 1 !== 0 || offset < 0)
          throw new RangeError("offset is not uint");
        if (offset + ext > length)
          throw new RangeError("Trying to access beyond buffer length");
      }
      Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE2(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        let val = this[offset];
        let mul = 1;
        let i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          checkOffset(offset, byteLength2, this.length);
        }
        let val = this[offset + --byteLength2];
        let mul = 1;
        while (byteLength2 > 0 && (mul *= 256)) {
          val += this[offset + --byteLength2] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 1, this.length);
        return this[offset];
      };
      Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        return this[offset] | this[offset + 1] << 8;
      };
      Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        return this[offset] << 8 | this[offset + 1];
      };
      Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
      };
      Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
      };
      Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
        const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
        return BigInt(lo) + (BigInt(hi) << BigInt(32));
      });
      Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
        const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
        return (BigInt(hi) << BigInt(32)) + BigInt(lo);
      });
      Buffer3.prototype.readIntLE = function readIntLE2(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        let val = this[offset];
        let mul = 1;
        let i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        mul *= 128;
        if (val >= mul)
          val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        let i = byteLength2;
        let mul = 1;
        let val = this[offset + --i];
        while (i > 0 && (mul *= 256)) {
          val += this[offset + --i] * mul;
        }
        mul *= 128;
        if (val >= mul)
          val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 1, this.length);
        if (!(this[offset] & 128))
          return this[offset];
        return (255 - this[offset] + 1) * -1;
      };
      Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        const val = this[offset] | this[offset + 1] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        const val = this[offset + 1] | this[offset] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
      };
      Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
      };
      Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
        return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
      });
      Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
        offset = offset >>> 0;
        validateNumber(offset, "offset");
        const first = this[offset];
        const last = this[offset + 7];
        if (first === void 0 || last === void 0) {
          boundsError(offset, this.length - 8);
        }
        const val = (first << 24) + // Overflow
        this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
        return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
      });
      Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, true, 23, 4);
      };
      Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, false, 23, 4);
      };
      Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, true, 52, 8);
      };
      Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, false, 52, 8);
      };
      function checkInt(buf, value4, offset, ext, max, min) {
        if (!Buffer3.isBuffer(buf))
          throw new TypeError('"buffer" argument must be a Buffer instance');
        if (value4 > max || value4 < min)
          throw new RangeError('"value" argument is out of bounds');
        if (offset + ext > buf.length)
          throw new RangeError("Index out of range");
      }
      Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE2(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value4, offset, byteLength2, maxBytes, 0);
        }
        let mul = 1;
        let i = 0;
        this[offset] = value4 & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          this[offset + i] = value4 / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value4, offset, byteLength2, maxBytes, 0);
        }
        let i = byteLength2 - 1;
        let mul = 1;
        this[offset + i] = value4 & 255;
        while (--i >= 0 && (mul *= 256)) {
          this[offset + i] = value4 / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 1, 255, 0);
        this[offset] = value4 & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 65535, 0);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 65535, 0);
        this[offset] = value4 >>> 8;
        this[offset + 1] = value4 & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 4294967295, 0);
        this[offset + 3] = value4 >>> 24;
        this[offset + 2] = value4 >>> 16;
        this[offset + 1] = value4 >>> 8;
        this[offset] = value4 & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 4294967295, 0);
        this[offset] = value4 >>> 24;
        this[offset + 1] = value4 >>> 16;
        this[offset + 2] = value4 >>> 8;
        this[offset + 3] = value4 & 255;
        return offset + 4;
      };
      function wrtBigUInt64LE(buf, value4, offset, min, max) {
        checkIntBI(value4, min, max, buf, offset, 7);
        let lo = Number(value4 & BigInt(4294967295));
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        lo = lo >> 8;
        buf[offset++] = lo;
        let hi = Number(value4 >> BigInt(32) & BigInt(4294967295));
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        hi = hi >> 8;
        buf[offset++] = hi;
        return offset;
      }
      function wrtBigUInt64BE(buf, value4, offset, min, max) {
        checkIntBI(value4, min, max, buf, offset, 7);
        let lo = Number(value4 & BigInt(4294967295));
        buf[offset + 7] = lo;
        lo = lo >> 8;
        buf[offset + 6] = lo;
        lo = lo >> 8;
        buf[offset + 5] = lo;
        lo = lo >> 8;
        buf[offset + 4] = lo;
        let hi = Number(value4 >> BigInt(32) & BigInt(4294967295));
        buf[offset + 3] = hi;
        hi = hi >> 8;
        buf[offset + 2] = hi;
        hi = hi >> 8;
        buf[offset + 1] = hi;
        hi = hi >> 8;
        buf[offset] = hi;
        return offset + 8;
      }
      Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value4, offset = 0) {
        return wrtBigUInt64LE(this, value4, offset, BigInt(0), BigInt("0xffffffffffffffff"));
      });
      Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value4, offset = 0) {
        return wrtBigUInt64BE(this, value4, offset, BigInt(0), BigInt("0xffffffffffffffff"));
      });
      Buffer3.prototype.writeIntLE = function writeIntLE2(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          const limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value4, offset, byteLength2, limit - 1, -limit);
        }
        let i = 0;
        let mul = 1;
        let sub = 0;
        this[offset] = value4 & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          if (value4 < 0 && sub === 0 && this[offset + i - 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value4 / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeIntBE = function writeIntBE(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          const limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value4, offset, byteLength2, limit - 1, -limit);
        }
        let i = byteLength2 - 1;
        let mul = 1;
        let sub = 0;
        this[offset + i] = value4 & 255;
        while (--i >= 0 && (mul *= 256)) {
          if (value4 < 0 && sub === 0 && this[offset + i + 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value4 / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeInt8 = function writeInt8(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 1, 127, -128);
        if (value4 < 0)
          value4 = 255 + value4 + 1;
        this[offset] = value4 & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeInt16LE = function writeInt16LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 32767, -32768);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeInt16BE = function writeInt16BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 32767, -32768);
        this[offset] = value4 >>> 8;
        this[offset + 1] = value4 & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeInt32LE = function writeInt32LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 2147483647, -2147483648);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        this[offset + 2] = value4 >>> 16;
        this[offset + 3] = value4 >>> 24;
        return offset + 4;
      };
      Buffer3.prototype.writeInt32BE = function writeInt32BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 2147483647, -2147483648);
        if (value4 < 0)
          value4 = 4294967295 + value4 + 1;
        this[offset] = value4 >>> 24;
        this[offset + 1] = value4 >>> 16;
        this[offset + 2] = value4 >>> 8;
        this[offset + 3] = value4 & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value4, offset = 0) {
        return wrtBigUInt64LE(this, value4, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
      });
      Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value4, offset = 0) {
        return wrtBigUInt64BE(this, value4, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
      });
      function checkIEEE754(buf, value4, offset, ext, max, min) {
        if (offset + ext > buf.length)
          throw new RangeError("Index out of range");
        if (offset < 0)
          throw new RangeError("Index out of range");
      }
      function writeFloat(buf, value4, offset, littleEndian, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value4, offset, 4, 34028234663852886e22, -34028234663852886e22);
        }
        ieee754.write(buf, value4, offset, littleEndian, 23, 4);
        return offset + 4;
      }
      Buffer3.prototype.writeFloatLE = function writeFloatLE(value4, offset, noAssert) {
        return writeFloat(this, value4, offset, true, noAssert);
      };
      Buffer3.prototype.writeFloatBE = function writeFloatBE(value4, offset, noAssert) {
        return writeFloat(this, value4, offset, false, noAssert);
      };
      function writeDouble(buf, value4, offset, littleEndian, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value4, offset, 8, 17976931348623157e292, -17976931348623157e292);
        }
        ieee754.write(buf, value4, offset, littleEndian, 52, 8);
        return offset + 8;
      }
      Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value4, offset, noAssert) {
        return writeDouble(this, value4, offset, true, noAssert);
      };
      Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value4, offset, noAssert) {
        return writeDouble(this, value4, offset, false, noAssert);
      };
      Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
        if (!Buffer3.isBuffer(target))
          throw new TypeError("argument should be a Buffer");
        if (!start)
          start = 0;
        if (!end && end !== 0)
          end = this.length;
        if (targetStart >= target.length)
          targetStart = target.length;
        if (!targetStart)
          targetStart = 0;
        if (end > 0 && end < start)
          end = start;
        if (end === start)
          return 0;
        if (target.length === 0 || this.length === 0)
          return 0;
        if (targetStart < 0) {
          throw new RangeError("targetStart out of bounds");
        }
        if (start < 0 || start >= this.length)
          throw new RangeError("Index out of range");
        if (end < 0)
          throw new RangeError("sourceEnd out of bounds");
        if (end > this.length)
          end = this.length;
        if (target.length - targetStart < end - start) {
          end = target.length - targetStart + start;
        }
        const len = end - start;
        if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
          this.copyWithin(targetStart, start, end);
        } else {
          Uint8Array.prototype.set.call(
            target,
            this.subarray(start, end),
            targetStart
          );
        }
        return len;
      };
      Buffer3.prototype.fill = function fill(val, start, end, encoding) {
        if (typeof val === "string") {
          if (typeof start === "string") {
            encoding = start;
            start = 0;
            end = this.length;
          } else if (typeof end === "string") {
            encoding = end;
            end = this.length;
          }
          if (encoding !== void 0 && typeof encoding !== "string") {
            throw new TypeError("encoding must be a string");
          }
          if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
            throw new TypeError("Unknown encoding: " + encoding);
          }
          if (val.length === 1) {
            const code = val.charCodeAt(0);
            if (encoding === "utf8" && code < 128 || encoding === "latin1") {
              val = code;
            }
          }
        } else if (typeof val === "number") {
          val = val & 255;
        } else if (typeof val === "boolean") {
          val = Number(val);
        }
        if (start < 0 || this.length < start || this.length < end) {
          throw new RangeError("Out of range index");
        }
        if (end <= start) {
          return this;
        }
        start = start >>> 0;
        end = end === void 0 ? this.length : end >>> 0;
        if (!val)
          val = 0;
        let i;
        if (typeof val === "number") {
          for (i = start; i < end; ++i) {
            this[i] = val;
          }
        } else {
          const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
          const len = bytes.length;
          if (len === 0) {
            throw new TypeError('The value "' + val + '" is invalid for argument "value"');
          }
          for (i = 0; i < end - start; ++i) {
            this[i + start] = bytes[i % len];
          }
        }
        return this;
      };
      var errors = {};
      function E2(sym, getMessage, Base) {
        errors[sym] = class NodeError extends Base {
          constructor() {
            super();
            Object.defineProperty(this, "message", {
              value: getMessage.apply(this, arguments),
              writable: true,
              configurable: true
            });
            this.name = `${this.name} [${sym}]`;
            this.stack;
            delete this.name;
          }
          get code() {
            return sym;
          }
          set code(value4) {
            Object.defineProperty(this, "code", {
              configurable: true,
              enumerable: true,
              value: value4,
              writable: true
            });
          }
          toString() {
            return `${this.name} [${sym}]: ${this.message}`;
          }
        };
      }
      E2(
        "ERR_BUFFER_OUT_OF_BOUNDS",
        function(name) {
          if (name) {
            return `${name} is outside of buffer bounds`;
          }
          return "Attempt to access memory outside buffer bounds";
        },
        RangeError
      );
      E2(
        "ERR_INVALID_ARG_TYPE",
        function(name, actual) {
          return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
        },
        TypeError
      );
      E2(
        "ERR_OUT_OF_RANGE",
        function(str, range, input) {
          let msg = `The value of "${str}" is out of range.`;
          let received = input;
          if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
            received = addNumericalSeparator(String(input));
          } else if (typeof input === "bigint") {
            received = String(input);
            if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
              received = addNumericalSeparator(received);
            }
            received += "n";
          }
          msg += ` It must be ${range}. Received ${received}`;
          return msg;
        },
        RangeError
      );
      function addNumericalSeparator(val) {
        let res = "";
        let i = val.length;
        const start = val[0] === "-" ? 1 : 0;
        for (; i >= start + 4; i -= 3) {
          res = `_${val.slice(i - 3, i)}${res}`;
        }
        return `${val.slice(0, i)}${res}`;
      }
      function checkBounds(buf, offset, byteLength2) {
        validateNumber(offset, "offset");
        if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
          boundsError(offset, buf.length - (byteLength2 + 1));
        }
      }
      function checkIntBI(value4, min, max, buf, offset, byteLength2) {
        if (value4 > max || value4 < min) {
          const n2 = typeof min === "bigint" ? "n" : "";
          let range;
          if (byteLength2 > 3) {
            if (min === 0 || min === BigInt(0)) {
              range = `>= 0${n2} and < 2${n2} ** ${(byteLength2 + 1) * 8}${n2}`;
            } else {
              range = `>= -(2${n2} ** ${(byteLength2 + 1) * 8 - 1}${n2}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n2}`;
            }
          } else {
            range = `>= ${min}${n2} and <= ${max}${n2}`;
          }
          throw new errors.ERR_OUT_OF_RANGE("value", range, value4);
        }
        checkBounds(buf, offset, byteLength2);
      }
      function validateNumber(value4, name) {
        if (typeof value4 !== "number") {
          throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value4);
        }
      }
      function boundsError(value4, length, type) {
        if (Math.floor(value4) !== value4) {
          validateNumber(value4, type);
          throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value4);
        }
        if (length < 0) {
          throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
        }
        throw new errors.ERR_OUT_OF_RANGE(
          type || "offset",
          `>= ${type ? 1 : 0} and <= ${length}`,
          value4
        );
      }
      var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
      function base64clean(str) {
        str = str.split("=")[0];
        str = str.trim().replace(INVALID_BASE64_RE, "");
        if (str.length < 2)
          return "";
        while (str.length % 4 !== 0) {
          str = str + "=";
        }
        return str;
      }
      function utf8ToBytes3(string, units) {
        units = units || Infinity;
        let codePoint;
        const length = string.length;
        let leadSurrogate = null;
        const bytes = [];
        for (let i = 0; i < length; ++i) {
          codePoint = string.charCodeAt(i);
          if (codePoint > 55295 && codePoint < 57344) {
            if (!leadSurrogate) {
              if (codePoint > 56319) {
                if ((units -= 3) > -1)
                  bytes.push(239, 191, 189);
                continue;
              } else if (i + 1 === length) {
                if ((units -= 3) > -1)
                  bytes.push(239, 191, 189);
                continue;
              }
              leadSurrogate = codePoint;
              continue;
            }
            if (codePoint < 56320) {
              if ((units -= 3) > -1)
                bytes.push(239, 191, 189);
              leadSurrogate = codePoint;
              continue;
            }
            codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
          } else if (leadSurrogate) {
            if ((units -= 3) > -1)
              bytes.push(239, 191, 189);
          }
          leadSurrogate = null;
          if (codePoint < 128) {
            if ((units -= 1) < 0)
              break;
            bytes.push(codePoint);
          } else if (codePoint < 2048) {
            if ((units -= 2) < 0)
              break;
            bytes.push(
              codePoint >> 6 | 192,
              codePoint & 63 | 128
            );
          } else if (codePoint < 65536) {
            if ((units -= 3) < 0)
              break;
            bytes.push(
              codePoint >> 12 | 224,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else if (codePoint < 1114112) {
            if ((units -= 4) < 0)
              break;
            bytes.push(
              codePoint >> 18 | 240,
              codePoint >> 12 & 63 | 128,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else {
            throw new Error("Invalid code point");
          }
        }
        return bytes;
      }
      function asciiToBytes(str) {
        const byteArray = [];
        for (let i = 0; i < str.length; ++i) {
          byteArray.push(str.charCodeAt(i) & 255);
        }
        return byteArray;
      }
      function utf16leToBytes(str, units) {
        let c3, hi, lo;
        const byteArray = [];
        for (let i = 0; i < str.length; ++i) {
          if ((units -= 2) < 0)
            break;
          c3 = str.charCodeAt(i);
          hi = c3 >> 8;
          lo = c3 % 256;
          byteArray.push(lo);
          byteArray.push(hi);
        }
        return byteArray;
      }
      function base64ToBytes(str) {
        return base64.toByteArray(base64clean(str));
      }
      function blitBuffer(src, dst, offset, length) {
        let i;
        for (i = 0; i < length; ++i) {
          if (i + offset >= dst.length || i >= src.length)
            break;
          dst[i + offset] = src[i];
        }
        return i;
      }
      function isInstance(obj, type) {
        return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
      }
      function numberIsNaN(obj) {
        return obj !== obj;
      }
      var hexSliceLookupTable = function() {
        const alphabet2 = "0123456789abcdef";
        const table = new Array(256);
        for (let i = 0; i < 16; ++i) {
          const i16 = i * 16;
          for (let j2 = 0; j2 < 16; ++j2) {
            table[i16 + j2] = alphabet2[i] + alphabet2[j2];
          }
        }
        return table;
      }();
      function defineBigIntMethod(fn) {
        return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
      }
      function BufferBigIntNotDefined() {
        throw new Error("BigInt not supported");
      }
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/api.js
  var ReplicaRejectCode;
  var init_api = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/api.js"() {
      (function(ReplicaRejectCode2) {
        ReplicaRejectCode2[ReplicaRejectCode2["SysFatal"] = 1] = "SysFatal";
        ReplicaRejectCode2[ReplicaRejectCode2["SysTransient"] = 2] = "SysTransient";
        ReplicaRejectCode2[ReplicaRejectCode2["DestinationInvalid"] = 3] = "DestinationInvalid";
        ReplicaRejectCode2[ReplicaRejectCode2["CanisterReject"] = 4] = "CanisterReject";
        ReplicaRejectCode2[ReplicaRejectCode2["CanisterError"] = 5] = "CanisterError";
      })(ReplicaRejectCode || (ReplicaRejectCode = {}));
    }
  });

  // node_modules/@dfinity/principal/lib/esm/utils/base32.js
  function encode(input) {
    let skip = 0;
    let bits = 0;
    let output = "";
    function encodeByte(byte) {
      if (skip < 0) {
        bits |= byte >> -skip;
      } else {
        bits = byte << skip & 248;
      }
      if (skip > 3) {
        skip -= 8;
        return 1;
      }
      if (skip < 4) {
        output += alphabet[bits >> 3];
        skip += 5;
      }
      return 0;
    }
    for (let i = 0; i < input.length; ) {
      i += encodeByte(input[i]);
    }
    return output + (skip < 0 ? alphabet[bits >> 3] : "");
  }
  function decode(input) {
    let skip = 0;
    let byte = 0;
    const output = new Uint8Array(input.length * 4 / 3 | 0);
    let o = 0;
    function decodeChar(char) {
      let val = lookupTable[char.toLowerCase()];
      if (val === void 0) {
        throw new Error(`Invalid character: ${JSON.stringify(char)}`);
      }
      val <<= 3;
      byte |= val >>> skip;
      skip += 5;
      if (skip >= 8) {
        output[o++] = byte;
        skip -= 8;
        if (skip > 0) {
          byte = val << 5 - skip & 255;
        } else {
          byte = 0;
        }
      }
    }
    for (const c3 of input) {
      decodeChar(c3);
    }
    return output.slice(0, o);
  }
  var alphabet, lookupTable;
  var init_base32 = __esm({
    "node_modules/@dfinity/principal/lib/esm/utils/base32.js"() {
      alphabet = "abcdefghijklmnopqrstuvwxyz234567";
      lookupTable = /* @__PURE__ */ Object.create(null);
      for (let i = 0; i < alphabet.length; i++) {
        lookupTable[alphabet[i]] = i;
      }
      lookupTable["0"] = lookupTable.o;
      lookupTable["1"] = lookupTable.i;
    }
  });

  // node_modules/@dfinity/principal/lib/esm/utils/getCrc.js
  function getCrc32(buf) {
    const b3 = new Uint8Array(buf);
    let crc = -1;
    for (let i = 0; i < b3.length; i++) {
      const byte = b3[i];
      const t2 = (byte ^ crc) & 255;
      crc = lookUpTable[t2] ^ crc >>> 8;
    }
    return (crc ^ -1) >>> 0;
  }
  var lookUpTable;
  var init_getCrc = __esm({
    "node_modules/@dfinity/principal/lib/esm/utils/getCrc.js"() {
      lookUpTable = new Uint32Array([
        0,
        1996959894,
        3993919788,
        2567524794,
        124634137,
        1886057615,
        3915621685,
        2657392035,
        249268274,
        2044508324,
        3772115230,
        2547177864,
        162941995,
        2125561021,
        3887607047,
        2428444049,
        498536548,
        1789927666,
        4089016648,
        2227061214,
        450548861,
        1843258603,
        4107580753,
        2211677639,
        325883990,
        1684777152,
        4251122042,
        2321926636,
        335633487,
        1661365465,
        4195302755,
        2366115317,
        997073096,
        1281953886,
        3579855332,
        2724688242,
        1006888145,
        1258607687,
        3524101629,
        2768942443,
        901097722,
        1119000684,
        3686517206,
        2898065728,
        853044451,
        1172266101,
        3705015759,
        2882616665,
        651767980,
        1373503546,
        3369554304,
        3218104598,
        565507253,
        1454621731,
        3485111705,
        3099436303,
        671266974,
        1594198024,
        3322730930,
        2970347812,
        795835527,
        1483230225,
        3244367275,
        3060149565,
        1994146192,
        31158534,
        2563907772,
        4023717930,
        1907459465,
        112637215,
        2680153253,
        3904427059,
        2013776290,
        251722036,
        2517215374,
        3775830040,
        2137656763,
        141376813,
        2439277719,
        3865271297,
        1802195444,
        476864866,
        2238001368,
        4066508878,
        1812370925,
        453092731,
        2181625025,
        4111451223,
        1706088902,
        314042704,
        2344532202,
        4240017532,
        1658658271,
        366619977,
        2362670323,
        4224994405,
        1303535960,
        984961486,
        2747007092,
        3569037538,
        1256170817,
        1037604311,
        2765210733,
        3554079995,
        1131014506,
        879679996,
        2909243462,
        3663771856,
        1141124467,
        855842277,
        2852801631,
        3708648649,
        1342533948,
        654459306,
        3188396048,
        3373015174,
        1466479909,
        544179635,
        3110523913,
        3462522015,
        1591671054,
        702138776,
        2966460450,
        3352799412,
        1504918807,
        783551873,
        3082640443,
        3233442989,
        3988292384,
        2596254646,
        62317068,
        1957810842,
        3939845945,
        2647816111,
        81470997,
        1943803523,
        3814918930,
        2489596804,
        225274430,
        2053790376,
        3826175755,
        2466906013,
        167816743,
        2097651377,
        4027552580,
        2265490386,
        503444072,
        1762050814,
        4150417245,
        2154129355,
        426522225,
        1852507879,
        4275313526,
        2312317920,
        282753626,
        1742555852,
        4189708143,
        2394877945,
        397917763,
        1622183637,
        3604390888,
        2714866558,
        953729732,
        1340076626,
        3518719985,
        2797360999,
        1068828381,
        1219638859,
        3624741850,
        2936675148,
        906185462,
        1090812512,
        3747672003,
        2825379669,
        829329135,
        1181335161,
        3412177804,
        3160834842,
        628085408,
        1382605366,
        3423369109,
        3138078467,
        570562233,
        1426400815,
        3317316542,
        2998733608,
        733239954,
        1555261956,
        3268935591,
        3050360625,
        752459403,
        1541320221,
        2607071920,
        3965973030,
        1969922972,
        40735498,
        2617837225,
        3943577151,
        1913087877,
        83908371,
        2512341634,
        3803740692,
        2075208622,
        213261112,
        2463272603,
        3855990285,
        2094854071,
        198958881,
        2262029012,
        4057260610,
        1759359992,
        534414190,
        2176718541,
        4139329115,
        1873836001,
        414664567,
        2282248934,
        4279200368,
        1711684554,
        285281116,
        2405801727,
        4167216745,
        1634467795,
        376229701,
        2685067896,
        3608007406,
        1308918612,
        956543938,
        2808555105,
        3495958263,
        1231636301,
        1047427035,
        2932959818,
        3654703836,
        1088359270,
        936918e3,
        2847714899,
        3736837829,
        1202900863,
        817233897,
        3183342108,
        3401237130,
        1404277552,
        615818150,
        3134207493,
        3453421203,
        1423857449,
        601450431,
        3009837614,
        3294710456,
        1567103746,
        711928724,
        3020668471,
        3272380065,
        1510334235,
        755167117
      ]);
    }
  });

  // node_modules/@noble/hashes/esm/_assert.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abytes(b3, ...lengths) {
    if (!isBytes(b3))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b3.length))
      throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b3.length);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  var init_assert = __esm({
    "node_modules/@noble/hashes/esm/_assert.js"() {
    }
  });

  // node_modules/@noble/hashes/esm/crypto.js
  var crypto2;
  var init_crypto = __esm({
    "node_modules/@noble/hashes/esm/crypto.js"() {
      crypto2 = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
    }
  });

  // node_modules/@noble/hashes/esm/utils.js
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("utf8ToBytes expected string, got " + typeof str);
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes(data);
    return data;
  }
  function wrapConstructor(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }
  function randomBytes(bytesLength = 32) {
    if (crypto2 && typeof crypto2.getRandomValues === "function") {
      return crypto2.getRandomValues(new Uint8Array(bytesLength));
    }
    if (crypto2 && typeof crypto2.randomBytes === "function") {
      return crypto2.randomBytes(bytesLength);
    }
    throw new Error("crypto.getRandomValues must be defined");
  }
  var createView, rotr, Hash;
  var init_utils = __esm({
    "node_modules/@noble/hashes/esm/utils.js"() {
      init_crypto();
      init_assert();
      createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      rotr = (word, shift) => word << 32 - shift | word >>> shift;
      Hash = class {
        // Safe version that clones internal state
        clone() {
          return this._cloneInto();
        }
      };
    }
  });

  // node_modules/@noble/hashes/esm/_md.js
  function setBigUint64(view, byteOffset, value4, isLE) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value4, isLE);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value4 >> _32n2 & _u32_max);
    const wl = Number(value4 & _u32_max);
    const h3 = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h3, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
  }
  var Chi, Maj, HashMD;
  var init_md = __esm({
    "node_modules/@noble/hashes/esm/_md.js"() {
      init_assert();
      init_utils();
      Chi = (a, b3, c3) => a & b3 ^ ~a & c3;
      Maj = (a, b3, c3) => a & b3 ^ a & c3 ^ b3 & c3;
      HashMD = class extends Hash {
        constructor(blockLen, outputLen, padOffset, isLE) {
          super();
          this.blockLen = blockLen;
          this.outputLen = outputLen;
          this.padOffset = padOffset;
          this.isLE = isLE;
          this.finished = false;
          this.length = 0;
          this.pos = 0;
          this.destroyed = false;
          this.buffer = new Uint8Array(blockLen);
          this.view = createView(this.buffer);
        }
        update(data) {
          aexists(this);
          const { view, buffer, blockLen } = this;
          data = toBytes(data);
          const len = data.length;
          for (let pos = 0; pos < len; ) {
            const take = Math.min(blockLen - this.pos, len - pos);
            if (take === blockLen) {
              const dataView = createView(data);
              for (; blockLen <= len - pos; pos += blockLen)
                this.process(dataView, pos);
              continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
              this.process(view, 0);
              this.pos = 0;
            }
          }
          this.length += data.length;
          this.roundClean();
          return this;
        }
        digestInto(out) {
          aexists(this);
          aoutput(out, this);
          this.finished = true;
          const { buffer, view, blockLen, isLE } = this;
          let { pos } = this;
          buffer[pos++] = 128;
          this.buffer.subarray(pos).fill(0);
          if (this.padOffset > blockLen - pos) {
            this.process(view, 0);
            pos = 0;
          }
          for (let i = pos; i < blockLen; i++)
            buffer[i] = 0;
          setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
          this.process(view, 0);
          const oview = createView(out);
          const len = this.outputLen;
          if (len % 4)
            throw new Error("_sha2: outputLen should be aligned to 32bit");
          const outLen = len / 4;
          const state = this.get();
          if (outLen > state.length)
            throw new Error("_sha2: outputLen bigger than state");
          for (let i = 0; i < outLen; i++)
            oview.setUint32(4 * i, state[i], isLE);
        }
        digest() {
          const { buffer, outputLen } = this;
          this.digestInto(buffer);
          const res = buffer.slice(0, outputLen);
          this.destroy();
          return res;
        }
        _cloneInto(to) {
          to || (to = new this.constructor());
          to.set(...this.get());
          const { blockLen, buffer, length, finished, destroyed, pos } = this;
          to.length = length;
          to.pos = pos;
          to.finished = finished;
          to.destroyed = destroyed;
          if (length % blockLen)
            to.buffer.set(buffer);
          return to;
        }
      };
    }
  });

  // node_modules/@noble/hashes/esm/sha256.js
  var SHA256_K, SHA256_IV, SHA256_W, SHA256, SHA224, sha256, sha224;
  var init_sha256 = __esm({
    "node_modules/@noble/hashes/esm/sha256.js"() {
      init_md();
      init_utils();
      SHA256_K = /* @__PURE__ */ new Uint32Array([
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ]);
      SHA256_IV = /* @__PURE__ */ new Uint32Array([
        1779033703,
        3144134277,
        1013904242,
        2773480762,
        1359893119,
        2600822924,
        528734635,
        1541459225
      ]);
      SHA256_W = /* @__PURE__ */ new Uint32Array(64);
      SHA256 = class extends HashMD {
        constructor() {
          super(64, 32, 8, false);
          this.A = SHA256_IV[0] | 0;
          this.B = SHA256_IV[1] | 0;
          this.C = SHA256_IV[2] | 0;
          this.D = SHA256_IV[3] | 0;
          this.E = SHA256_IV[4] | 0;
          this.F = SHA256_IV[5] | 0;
          this.G = SHA256_IV[6] | 0;
          this.H = SHA256_IV[7] | 0;
        }
        get() {
          const { A: A2, B: B2, C: C2, D: D2, E: E2, F, G: G2, H } = this;
          return [A2, B2, C2, D2, E2, F, G2, H];
        }
        // prettier-ignore
        set(A2, B2, C2, D2, E2, F, G2, H) {
          this.A = A2 | 0;
          this.B = B2 | 0;
          this.C = C2 | 0;
          this.D = D2 | 0;
          this.E = E2 | 0;
          this.F = F | 0;
          this.G = G2 | 0;
          this.H = H | 0;
        }
        process(view, offset) {
          for (let i = 0; i < 16; i++, offset += 4)
            SHA256_W[i] = view.getUint32(offset, false);
          for (let i = 16; i < 64; i++) {
            const W15 = SHA256_W[i - 15];
            const W22 = SHA256_W[i - 2];
            const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
            const s1 = rotr(W22, 17) ^ rotr(W22, 19) ^ W22 >>> 10;
            SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
          }
          let { A: A2, B: B2, C: C2, D: D2, E: E2, F, G: G2, H } = this;
          for (let i = 0; i < 64; i++) {
            const sigma1 = rotr(E2, 6) ^ rotr(E2, 11) ^ rotr(E2, 25);
            const T1 = H + sigma1 + Chi(E2, F, G2) + SHA256_K[i] + SHA256_W[i] | 0;
            const sigma0 = rotr(A2, 2) ^ rotr(A2, 13) ^ rotr(A2, 22);
            const T22 = sigma0 + Maj(A2, B2, C2) | 0;
            H = G2;
            G2 = F;
            F = E2;
            E2 = D2 + T1 | 0;
            D2 = C2;
            C2 = B2;
            B2 = A2;
            A2 = T1 + T22 | 0;
          }
          A2 = A2 + this.A | 0;
          B2 = B2 + this.B | 0;
          C2 = C2 + this.C | 0;
          D2 = D2 + this.D | 0;
          E2 = E2 + this.E | 0;
          F = F + this.F | 0;
          G2 = G2 + this.G | 0;
          H = H + this.H | 0;
          this.set(A2, B2, C2, D2, E2, F, G2, H);
        }
        roundClean() {
          SHA256_W.fill(0);
        }
        destroy() {
          this.set(0, 0, 0, 0, 0, 0, 0, 0);
          this.buffer.fill(0);
        }
      };
      SHA224 = class extends SHA256 {
        constructor() {
          super();
          this.A = 3238371032 | 0;
          this.B = 914150663 | 0;
          this.C = 812702999 | 0;
          this.D = 4144912697 | 0;
          this.E = 4290775857 | 0;
          this.F = 1750603025 | 0;
          this.G = 1694076839 | 0;
          this.H = 3204075428 | 0;
          this.outputLen = 28;
        }
      };
      sha256 = /* @__PURE__ */ wrapConstructor(() => new SHA256());
      sha224 = /* @__PURE__ */ wrapConstructor(() => new SHA224());
    }
  });

  // node_modules/@dfinity/principal/lib/esm/utils/sha224.js
  function sha2242(data) {
    return sha224.create().update(new Uint8Array(data)).digest();
  }
  var init_sha224 = __esm({
    "node_modules/@dfinity/principal/lib/esm/utils/sha224.js"() {
      init_sha256();
    }
  });

  // node_modules/@dfinity/principal/lib/esm/index.js
  var JSON_KEY_PRINCIPAL, SELF_AUTHENTICATING_SUFFIX, ANONYMOUS_SUFFIX, MANAGEMENT_CANISTER_PRINCIPAL_HEX_STR, fromHexString, toHexString, Principal;
  var init_esm = __esm({
    "node_modules/@dfinity/principal/lib/esm/index.js"() {
      init_base32();
      init_getCrc();
      init_sha224();
      JSON_KEY_PRINCIPAL = "__principal__";
      SELF_AUTHENTICATING_SUFFIX = 2;
      ANONYMOUS_SUFFIX = 4;
      MANAGEMENT_CANISTER_PRINCIPAL_HEX_STR = "aaaaa-aa";
      fromHexString = (hexString) => {
        var _a2;
        return new Uint8Array(((_a2 = hexString.match(/.{1,2}/g)) !== null && _a2 !== void 0 ? _a2 : []).map((byte) => parseInt(byte, 16)));
      };
      toHexString = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");
      Principal = class _Principal {
        constructor(_arr) {
          this._arr = _arr;
          this._isPrincipal = true;
        }
        static anonymous() {
          return new this(new Uint8Array([ANONYMOUS_SUFFIX]));
        }
        /**
         * Utility method, returning the principal representing the management canister, decoded from the hex string `'aaaaa-aa'`
         * @returns {Principal} principal of the management canister
         */
        static managementCanister() {
          return this.fromHex(MANAGEMENT_CANISTER_PRINCIPAL_HEX_STR);
        }
        static selfAuthenticating(publicKey) {
          const sha = sha2242(publicKey);
          return new this(new Uint8Array([...sha, SELF_AUTHENTICATING_SUFFIX]));
        }
        static from(other) {
          if (typeof other === "string") {
            return _Principal.fromText(other);
          } else if (Object.getPrototypeOf(other) === Uint8Array.prototype) {
            return new _Principal(other);
          } else if (typeof other === "object" && other !== null && other._isPrincipal === true) {
            return new _Principal(other._arr);
          }
          throw new Error(`Impossible to convert ${JSON.stringify(other)} to Principal.`);
        }
        static fromHex(hex) {
          return new this(fromHexString(hex));
        }
        static fromText(text) {
          let maybePrincipal = text;
          if (text.includes(JSON_KEY_PRINCIPAL)) {
            const obj = JSON.parse(text);
            if (JSON_KEY_PRINCIPAL in obj) {
              maybePrincipal = obj[JSON_KEY_PRINCIPAL];
            }
          }
          const canisterIdNoDash = maybePrincipal.toLowerCase().replace(/-/g, "");
          let arr = decode(canisterIdNoDash);
          arr = arr.slice(4, arr.length);
          const principal = new this(arr);
          if (principal.toText() !== maybePrincipal) {
            throw new Error(`Principal "${principal.toText()}" does not have a valid checksum (original value "${maybePrincipal}" may not be a valid Principal ID).`);
          }
          return principal;
        }
        static fromUint8Array(arr) {
          return new this(arr);
        }
        isAnonymous() {
          return this._arr.byteLength === 1 && this._arr[0] === ANONYMOUS_SUFFIX;
        }
        toUint8Array() {
          return this._arr;
        }
        toHex() {
          return toHexString(this._arr).toUpperCase();
        }
        toText() {
          const checksumArrayBuf = new ArrayBuffer(4);
          const view = new DataView(checksumArrayBuf);
          view.setUint32(0, getCrc32(this._arr));
          const checksum = new Uint8Array(checksumArrayBuf);
          const bytes = Uint8Array.from(this._arr);
          const array = new Uint8Array([...checksum, ...bytes]);
          const result = encode(array);
          const matches = result.match(/.{1,5}/g);
          if (!matches) {
            throw new Error();
          }
          return matches.join("-");
        }
        toString() {
          return this.toText();
        }
        /**
         * Serializes to JSON
         * @returns {JsonnablePrincipal} a JSON object with a single key, {@link JSON_KEY_PRINCIPAL}, whose value is the principal as a string
         */
        toJSON() {
          return { [JSON_KEY_PRINCIPAL]: this.toText() };
        }
        /**
         * Utility method taking a Principal to compare against. Used for determining canister ranges in certificate verification
         * @param {Principal} other - a {@link Principal} to compare
         * @returns {'lt' | 'eq' | 'gt'} `'lt' | 'eq' | 'gt'` a string, representing less than, equal to, or greater than
         */
        compareTo(other) {
          for (let i = 0; i < Math.min(this._arr.length, other._arr.length); i++) {
            if (this._arr[i] < other._arr[i])
              return "lt";
            else if (this._arr[i] > other._arr[i])
              return "gt";
          }
          if (this._arr.length < other._arr.length)
            return "lt";
          if (this._arr.length > other._arr.length)
            return "gt";
          return "eq";
        }
        /**
         * Utility method checking whether a provided Principal is less than or equal to the current one using the {@link Principal.compareTo} method
         * @param other a {@link Principal} to compare
         * @returns {boolean} boolean
         */
        ltEq(other) {
          const cmp = this.compareTo(other);
          return cmp == "lt" || cmp == "eq";
        }
        /**
         * Utility method checking whether a provided Principal is greater than or equal to the current one using the {@link Principal.compareTo} method
         * @param other a {@link Principal} to compare
         * @returns {boolean} boolean
         */
        gtEq(other) {
          const cmp = this.compareTo(other);
          return cmp == "gt" || cmp == "eq";
        }
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/utils/buffer.js
  function concat(...buffers) {
    const result = new Uint8Array(buffers.reduce((acc, curr) => acc + curr.byteLength, 0));
    let index = 0;
    for (const b3 of buffers) {
      result.set(new Uint8Array(b3), index);
      index += b3.byteLength;
    }
    return result.buffer;
  }
  function toHex(buffer) {
    return [...new Uint8Array(buffer)].map((x5) => x5.toString(16).padStart(2, "0")).join("");
  }
  function fromHex(hex) {
    if (!hexRe.test(hex)) {
      throw new Error("Invalid hexadecimal string.");
    }
    const buffer = [...hex].reduce((acc, curr, i) => {
      acc[i / 2 | 0] = (acc[i / 2 | 0] || "") + curr;
      return acc;
    }, []).map((x5) => Number.parseInt(x5, 16));
    return new Uint8Array(buffer).buffer;
  }
  function compare(b1, b22) {
    if (b1.byteLength !== b22.byteLength) {
      return b1.byteLength - b22.byteLength;
    }
    const u1 = new Uint8Array(b1);
    const u2 = new Uint8Array(b22);
    for (let i = 0; i < u1.length; i++) {
      if (u1[i] !== u2[i]) {
        return u1[i] - u2[i];
      }
    }
    return 0;
  }
  function bufEquals(b1, b22) {
    return compare(b1, b22) === 0;
  }
  function uint8ToBuf(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength).buffer;
  }
  function bufFromBufLike(bufLike) {
    if (bufLike instanceof Uint8Array) {
      return uint8ToBuf(bufLike);
    }
    if (bufLike instanceof ArrayBuffer) {
      return bufLike;
    }
    if (Array.isArray(bufLike)) {
      return uint8ToBuf(new Uint8Array(bufLike));
    }
    if ("buffer" in bufLike) {
      return bufFromBufLike(bufLike.buffer);
    }
    return uint8ToBuf(new Uint8Array(bufLike));
  }
  var hexRe;
  var init_buffer = __esm({
    "node_modules/@dfinity/agent/lib/esm/utils/buffer.js"() {
      hexRe = new RegExp(/^[0-9a-fA-F]+$/);
    }
  });

  // node_modules/@dfinity/agent/lib/esm/errors.js
  var AgentError;
  var init_errors = __esm({
    "node_modules/@dfinity/agent/lib/esm/errors.js"() {
      init_esm();
      init_api();
      init_buffer();
      AgentError = class _AgentError extends Error {
        constructor(message) {
          super(message);
          this.message = message;
          this.name = "AgentError";
          this.__proto__ = _AgentError.prototype;
          Object.setPrototypeOf(this, _AgentError.prototype);
        }
      };
    }
  });

  // node_modules/@dfinity/candid/lib/esm/utils/buffer.js
  function concat2(...buffers) {
    const result = new Uint8Array(buffers.reduce((acc, curr) => acc + curr.byteLength, 0));
    let index = 0;
    for (const b3 of buffers) {
      result.set(new Uint8Array(b3), index);
      index += b3.byteLength;
    }
    return result;
  }
  function uint8ToBuf2(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength).buffer;
  }
  function bufFromBufLike2(bufLike) {
    if (bufLike instanceof Uint8Array) {
      return uint8ToBuf2(bufLike);
    }
    if (bufLike instanceof ArrayBuffer) {
      return bufLike;
    }
    if (Array.isArray(bufLike)) {
      return uint8ToBuf2(new Uint8Array(bufLike));
    }
    if ("buffer" in bufLike) {
      return bufFromBufLike2(bufLike.buffer);
    }
    return uint8ToBuf2(new Uint8Array(bufLike));
  }
  var PipeArrayBuffer;
  var init_buffer2 = __esm({
    "node_modules/@dfinity/candid/lib/esm/utils/buffer.js"() {
      PipeArrayBuffer = class {
        /**
         * Creates a new instance of a pipe
         * @param buffer an optional buffer to start with
         * @param length an optional amount of bytes to use for the length.
         */
        constructor(buffer, length = (buffer === null || buffer === void 0 ? void 0 : buffer.byteLength) || 0) {
          this._buffer = bufFromBufLike2(buffer || new ArrayBuffer(0));
          this._view = new Uint8Array(this._buffer, 0, length);
        }
        get buffer() {
          return bufFromBufLike2(this._view.slice());
        }
        get byteLength() {
          return this._view.byteLength;
        }
        /**
         * Read `num` number of bytes from the front of the pipe.
         * @param num The number of bytes to read.
         */
        read(num) {
          const result = this._view.subarray(0, num);
          this._view = this._view.subarray(num);
          return result.slice().buffer;
        }
        readUint8() {
          const result = this._view[0];
          this._view = this._view.subarray(1);
          return result;
        }
        /**
         * Write a buffer to the end of the pipe.
         * @param buf The bytes to write.
         */
        write(buf) {
          const b3 = new Uint8Array(buf);
          const offset = this._view.byteLength;
          if (this._view.byteOffset + this._view.byteLength + b3.byteLength >= this._buffer.byteLength) {
            this.alloc(b3.byteLength);
          } else {
            this._view = new Uint8Array(this._buffer, this._view.byteOffset, this._view.byteLength + b3.byteLength);
          }
          this._view.set(b3, offset);
        }
        /**
         * Whether or not there is more data to read from the buffer
         */
        get end() {
          return this._view.byteLength === 0;
        }
        /**
         * Allocate a fixed amount of memory in the buffer. This does not affect the view.
         * @param amount A number of bytes to add to the buffer.
         */
        alloc(amount) {
          const b3 = new ArrayBuffer((this._buffer.byteLength + amount) * 1.2 | 0);
          const v2 = new Uint8Array(b3, 0, this._view.byteLength + amount);
          v2.set(this._view);
          this._buffer = b3;
          this._view = v2;
        }
      };
    }
  });

  // node_modules/@dfinity/candid/lib/esm/utils/hash.js
  function idlHash(s2) {
    const utf8encoder = new TextEncoder();
    const array = utf8encoder.encode(s2);
    let h3 = 0;
    for (const c3 of array) {
      h3 = (h3 * 223 + c3) % 2 ** 32;
    }
    return h3;
  }
  function idlLabelToId(label) {
    if (/^_\d+_$/.test(label) || /^_0x[0-9a-fA-F]+_$/.test(label)) {
      const num = +label.slice(1, -1);
      if (Number.isSafeInteger(num) && num >= 0 && num < 2 ** 32) {
        return num;
      }
    }
    return idlHash(label);
  }
  var init_hash = __esm({
    "node_modules/@dfinity/candid/lib/esm/utils/hash.js"() {
    }
  });

  // node_modules/@dfinity/candid/lib/esm/utils/leb128.js
  function eob() {
    throw new Error("unexpected end of buffer");
  }
  function safeRead(pipe, num) {
    if (pipe.byteLength < num) {
      eob();
    }
    return pipe.read(num);
  }
  function safeReadUint8(pipe) {
    const byte = pipe.readUint8();
    if (byte === void 0) {
      eob();
    }
    return byte;
  }
  function lebEncode(value4) {
    if (typeof value4 === "number") {
      value4 = BigInt(value4);
    }
    if (value4 < BigInt(0)) {
      throw new Error("Cannot leb encode negative values.");
    }
    const byteLength = (value4 === BigInt(0) ? 0 : Math.ceil(Math.log2(Number(value4)))) + 1;
    const pipe = new PipeArrayBuffer(new ArrayBuffer(byteLength), 0);
    while (true) {
      const i = Number(value4 & BigInt(127));
      value4 /= BigInt(128);
      if (value4 === BigInt(0)) {
        pipe.write(new Uint8Array([i]));
        break;
      } else {
        pipe.write(new Uint8Array([i | 128]));
      }
    }
    return pipe.buffer;
  }
  function lebDecode(pipe) {
    let weight = BigInt(1);
    let value4 = BigInt(0);
    let byte;
    do {
      byte = safeReadUint8(pipe);
      value4 += BigInt(byte & 127).valueOf() * weight;
      weight *= BigInt(128);
    } while (byte >= 128);
    return value4;
  }
  function slebEncode(value4) {
    if (typeof value4 === "number") {
      value4 = BigInt(value4);
    }
    const isNeg = value4 < BigInt(0);
    if (isNeg) {
      value4 = -value4 - BigInt(1);
    }
    const byteLength = (value4 === BigInt(0) ? 0 : Math.ceil(Math.log2(Number(value4)))) + 1;
    const pipe = new PipeArrayBuffer(new ArrayBuffer(byteLength), 0);
    while (true) {
      const i = getLowerBytes(value4);
      value4 /= BigInt(128);
      if (isNeg && value4 === BigInt(0) && (i & 64) !== 0 || !isNeg && value4 === BigInt(0) && (i & 64) === 0) {
        pipe.write(new Uint8Array([i]));
        break;
      } else {
        pipe.write(new Uint8Array([i | 128]));
      }
    }
    function getLowerBytes(num) {
      const bytes = num % BigInt(128);
      if (isNeg) {
        return Number(BigInt(128) - bytes - BigInt(1));
      } else {
        return Number(bytes);
      }
    }
    return pipe.buffer;
  }
  function slebDecode(pipe) {
    const pipeView = new Uint8Array(pipe.buffer);
    let len = 0;
    for (; len < pipeView.byteLength; len++) {
      if (pipeView[len] < 128) {
        if ((pipeView[len] & 64) === 0) {
          return lebDecode(pipe);
        }
        break;
      }
    }
    const bytes = new Uint8Array(safeRead(pipe, len + 1));
    let value4 = BigInt(0);
    for (let i = bytes.byteLength - 1; i >= 0; i--) {
      value4 = value4 * BigInt(128) + BigInt(128 - (bytes[i] & 127) - 1);
    }
    return -value4 - BigInt(1);
  }
  function writeUIntLE(value4, byteLength) {
    if (BigInt(value4) < BigInt(0)) {
      throw new Error("Cannot write negative values.");
    }
    return writeIntLE(value4, byteLength);
  }
  function writeIntLE(value4, byteLength) {
    value4 = BigInt(value4);
    const pipe = new PipeArrayBuffer(new ArrayBuffer(Math.min(1, byteLength)), 0);
    let i = 0;
    let mul = BigInt(256);
    let sub = BigInt(0);
    let byte = Number(value4 % mul);
    pipe.write(new Uint8Array([byte]));
    while (++i < byteLength) {
      if (value4 < 0 && sub === BigInt(0) && byte !== 0) {
        sub = BigInt(1);
      }
      byte = Number((value4 / mul - sub) % BigInt(256));
      pipe.write(new Uint8Array([byte]));
      mul *= BigInt(256);
    }
    return pipe.buffer;
  }
  function readUIntLE(pipe, byteLength) {
    let val = BigInt(safeReadUint8(pipe));
    let mul = BigInt(1);
    let i = 0;
    while (++i < byteLength) {
      mul *= BigInt(256);
      const byte = BigInt(safeReadUint8(pipe));
      val = val + mul * byte;
    }
    return val;
  }
  function readIntLE(pipe, byteLength) {
    let val = readUIntLE(pipe, byteLength);
    const mul = BigInt(2) ** (BigInt(8) * BigInt(byteLength - 1) + BigInt(7));
    if (val >= mul) {
      val -= mul * BigInt(2);
    }
    return val;
  }
  var init_leb128 = __esm({
    "node_modules/@dfinity/candid/lib/esm/utils/leb128.js"() {
      init_buffer2();
    }
  });

  // node_modules/@dfinity/candid/lib/esm/utils/bigint-math.js
  function iexp2(n2) {
    const nBig = BigInt(n2);
    if (n2 < 0) {
      throw new RangeError("Input must be non-negative");
    }
    return BigInt(1) << nBig;
  }
  var init_bigint_math = __esm({
    "node_modules/@dfinity/candid/lib/esm/utils/bigint-math.js"() {
    }
  });

  // node_modules/@dfinity/candid/lib/esm/idl.js
  var idl_exports = {};
  __export(idl_exports, {
    Bool: () => Bool,
    BoolClass: () => BoolClass,
    ConstructType: () => ConstructType,
    Empty: () => Empty,
    EmptyClass: () => EmptyClass,
    FixedIntClass: () => FixedIntClass,
    FixedNatClass: () => FixedNatClass,
    Float32: () => Float32,
    Float64: () => Float64,
    FloatClass: () => FloatClass,
    Func: () => Func,
    FuncClass: () => FuncClass,
    Int: () => Int,
    Int16: () => Int16,
    Int32: () => Int32,
    Int64: () => Int64,
    Int8: () => Int8,
    IntClass: () => IntClass,
    Nat: () => Nat,
    Nat16: () => Nat16,
    Nat32: () => Nat32,
    Nat64: () => Nat64,
    Nat8: () => Nat8,
    NatClass: () => NatClass,
    Null: () => Null,
    NullClass: () => NullClass,
    Opt: () => Opt,
    OptClass: () => OptClass,
    PrimitiveType: () => PrimitiveType,
    Principal: () => Principal2,
    PrincipalClass: () => PrincipalClass,
    Rec: () => Rec,
    RecClass: () => RecClass,
    Record: () => Record,
    RecordClass: () => RecordClass,
    Reserved: () => Reserved,
    ReservedClass: () => ReservedClass,
    Service: () => Service,
    ServiceClass: () => ServiceClass,
    Text: () => Text,
    TextClass: () => TextClass,
    Tuple: () => Tuple,
    TupleClass: () => TupleClass,
    Type: () => Type,
    Unknown: () => Unknown,
    UnknownClass: () => UnknownClass,
    Variant: () => Variant,
    VariantClass: () => VariantClass,
    Vec: () => Vec,
    VecClass: () => VecClass,
    Visitor: () => Visitor,
    decode: () => decode2,
    encode: () => encode2
  });
  function zipWith(xs, ys, f4) {
    return xs.map((x5, i) => f4(x5, ys[i]));
  }
  function decodePrincipalId(b3) {
    const x5 = safeReadUint8(b3);
    if (x5 !== 1) {
      throw new Error("Cannot decode principal");
    }
    const len = Number(lebDecode(b3));
    return Principal.fromUint8Array(new Uint8Array(safeRead(b3, len)));
  }
  function toReadableString(x5) {
    const str = JSON.stringify(x5, (_key, value4) => typeof value4 === "bigint" ? `BigInt(${value4})` : value4);
    return str && str.length > toReadableString_max ? str.substring(0, toReadableString_max - 3) + "..." : str;
  }
  function encode2(argTypes, args) {
    if (args.length < argTypes.length) {
      throw Error("Wrong number of message arguments");
    }
    const typeTable = new TypeTable();
    argTypes.forEach((t2) => t2.buildTypeTable(typeTable));
    const magic = new TextEncoder().encode(magicNumber);
    const table = typeTable.encode();
    const len = lebEncode(args.length);
    const typs = concat2(...argTypes.map((t2) => t2.encodeType(typeTable)));
    const vals = concat2(...zipWith(argTypes, args, (t2, x5) => {
      try {
        t2.covariant(x5);
      } catch (e3) {
        const err = new Error(e3.message + "\n\n");
        throw err;
      }
      return t2.encodeValue(x5);
    }));
    return concat2(magic, table, len, typs, vals);
  }
  function decode2(retTypes, bytes) {
    const b3 = new PipeArrayBuffer(bytes);
    if (bytes.byteLength < magicNumber.length) {
      throw new Error("Message length smaller than magic number");
    }
    const magicBuffer = safeRead(b3, magicNumber.length);
    const magic = new TextDecoder().decode(magicBuffer);
    if (magic !== magicNumber) {
      throw new Error("Wrong magic number: " + JSON.stringify(magic));
    }
    function readTypeTable(pipe) {
      const typeTable = [];
      const len = Number(lebDecode(pipe));
      for (let i = 0; i < len; i++) {
        const ty = Number(slebDecode(pipe));
        switch (ty) {
          case -18:
          case -19: {
            const t2 = Number(slebDecode(pipe));
            typeTable.push([ty, t2]);
            break;
          }
          case -20:
          case -21: {
            const fields = [];
            let objectLength = Number(lebDecode(pipe));
            let prevHash;
            while (objectLength--) {
              const hash2 = Number(lebDecode(pipe));
              if (hash2 >= Math.pow(2, 32)) {
                throw new Error("field id out of 32-bit range");
              }
              if (typeof prevHash === "number" && prevHash >= hash2) {
                throw new Error("field id collision or not sorted");
              }
              prevHash = hash2;
              const t2 = Number(slebDecode(pipe));
              fields.push([hash2, t2]);
            }
            typeTable.push([ty, fields]);
            break;
          }
          case -22: {
            const args = [];
            let argLength = Number(lebDecode(pipe));
            while (argLength--) {
              args.push(Number(slebDecode(pipe)));
            }
            const returnValues = [];
            let returnValuesLength = Number(lebDecode(pipe));
            while (returnValuesLength--) {
              returnValues.push(Number(slebDecode(pipe)));
            }
            const annotations = [];
            let annotationLength = Number(lebDecode(pipe));
            while (annotationLength--) {
              const annotation = Number(lebDecode(pipe));
              switch (annotation) {
                case 1: {
                  annotations.push("query");
                  break;
                }
                case 2: {
                  annotations.push("oneway");
                  break;
                }
                case 3: {
                  annotations.push("composite_query");
                  break;
                }
                default:
                  throw new Error("unknown annotation");
              }
            }
            typeTable.push([ty, [args, returnValues, annotations]]);
            break;
          }
          case -23: {
            let servLength = Number(lebDecode(pipe));
            const methods = [];
            while (servLength--) {
              const nameLength = Number(lebDecode(pipe));
              const funcName = new TextDecoder().decode(safeRead(pipe, nameLength));
              const funcType = slebDecode(pipe);
              methods.push([funcName, funcType]);
            }
            typeTable.push([ty, methods]);
            break;
          }
          default:
            throw new Error("Illegal op_code: " + ty);
        }
      }
      const rawList = [];
      const length = Number(lebDecode(pipe));
      for (let i = 0; i < length; i++) {
        rawList.push(Number(slebDecode(pipe)));
      }
      return [typeTable, rawList];
    }
    const [rawTable, rawTypes] = readTypeTable(b3);
    if (rawTypes.length < retTypes.length) {
      throw new Error("Wrong number of return values");
    }
    const table = rawTable.map((_2) => Rec());
    function getType(t2) {
      if (t2 < -24) {
        throw new Error("future value not supported");
      }
      if (t2 < 0) {
        switch (t2) {
          case -1:
            return Null;
          case -2:
            return Bool;
          case -3:
            return Nat;
          case -4:
            return Int;
          case -5:
            return Nat8;
          case -6:
            return Nat16;
          case -7:
            return Nat32;
          case -8:
            return Nat64;
          case -9:
            return Int8;
          case -10:
            return Int16;
          case -11:
            return Int32;
          case -12:
            return Int64;
          case -13:
            return Float32;
          case -14:
            return Float64;
          case -15:
            return Text;
          case -16:
            return Reserved;
          case -17:
            return Empty;
          case -24:
            return Principal2;
          default:
            throw new Error("Illegal op_code: " + t2);
        }
      }
      if (t2 >= rawTable.length) {
        throw new Error("type index out of range");
      }
      return table[t2];
    }
    function buildType(entry) {
      switch (entry[0]) {
        case -19: {
          const ty = getType(entry[1]);
          return Vec(ty);
        }
        case -18: {
          const ty = getType(entry[1]);
          return Opt(ty);
        }
        case -20: {
          const fields = {};
          for (const [hash2, ty] of entry[1]) {
            const name = `_${hash2}_`;
            fields[name] = getType(ty);
          }
          const record = Record(fields);
          const tuple = record.tryAsTuple();
          if (Array.isArray(tuple)) {
            return Tuple(...tuple);
          } else {
            return record;
          }
        }
        case -21: {
          const fields = {};
          for (const [hash2, ty] of entry[1]) {
            const name = `_${hash2}_`;
            fields[name] = getType(ty);
          }
          return Variant(fields);
        }
        case -22: {
          const [args, returnValues, annotations] = entry[1];
          return Func(args.map((t2) => getType(t2)), returnValues.map((t2) => getType(t2)), annotations);
        }
        case -23: {
          const rec = {};
          const methods = entry[1];
          for (const [name, typeRef] of methods) {
            let type = getType(typeRef);
            if (type instanceof RecClass) {
              type = type.getType();
            }
            if (!(type instanceof FuncClass)) {
              throw new Error("Illegal service definition: services can only contain functions");
            }
            rec[name] = type;
          }
          return Service(rec);
        }
        default:
          throw new Error("Illegal op_code: " + entry[0]);
      }
    }
    rawTable.forEach((entry, i) => {
      if (entry[0] === -22) {
        const t2 = buildType(entry);
        table[i].fill(t2);
      }
    });
    rawTable.forEach((entry, i) => {
      if (entry[0] !== -22) {
        const t2 = buildType(entry);
        table[i].fill(t2);
      }
    });
    const types = rawTypes.map((t2) => getType(t2));
    const output = retTypes.map((t2, i) => {
      return t2.decodeValue(b3, types[i]);
    });
    for (let ind = retTypes.length; ind < types.length; ind++) {
      types[ind].decodeValue(b3, types[ind]);
    }
    if (b3.byteLength > 0) {
      throw new Error("decode: Left-over bytes");
    }
    return output;
  }
  function Tuple(...types) {
    return new TupleClass(types);
  }
  function Vec(t2) {
    return new VecClass(t2);
  }
  function Opt(t2) {
    return new OptClass(t2);
  }
  function Record(t2) {
    return new RecordClass(t2);
  }
  function Variant(fields) {
    return new VariantClass(fields);
  }
  function Rec() {
    return new RecClass();
  }
  function Func(args, ret, annotations = []) {
    return new FuncClass(args, ret, annotations);
  }
  function Service(t2) {
    return new ServiceClass(t2);
  }
  var magicNumber, toReadableString_max, TypeTable, Visitor, Type, PrimitiveType, ConstructType, EmptyClass, UnknownClass, BoolClass, NullClass, ReservedClass, TextClass, IntClass, NatClass, FloatClass, FixedIntClass, FixedNatClass, VecClass, OptClass, RecordClass, TupleClass, VariantClass, RecClass, PrincipalClass, FuncClass, ServiceClass, Empty, Reserved, Unknown, Bool, Null, Text, Int, Nat, Float32, Float64, Int8, Int16, Int32, Int64, Nat8, Nat16, Nat32, Nat64, Principal2;
  var init_idl = __esm({
    "node_modules/@dfinity/candid/lib/esm/idl.js"() {
      init_esm();
      init_buffer2();
      init_hash();
      init_leb128();
      init_bigint_math();
      magicNumber = "DIDL";
      toReadableString_max = 400;
      TypeTable = class {
        constructor() {
          this._typs = [];
          this._idx = /* @__PURE__ */ new Map();
        }
        has(obj) {
          return this._idx.has(obj.name);
        }
        add(type, buf) {
          const idx = this._typs.length;
          this._idx.set(type.name, idx);
          this._typs.push(buf);
        }
        merge(obj, knot) {
          const idx = this._idx.get(obj.name);
          const knotIdx = this._idx.get(knot);
          if (idx === void 0) {
            throw new Error("Missing type index for " + obj);
          }
          if (knotIdx === void 0) {
            throw new Error("Missing type index for " + knot);
          }
          this._typs[idx] = this._typs[knotIdx];
          this._typs.splice(knotIdx, 1);
          this._idx.delete(knot);
        }
        encode() {
          const len = lebEncode(this._typs.length);
          const buf = concat2(...this._typs);
          return concat2(len, buf);
        }
        indexOf(typeName) {
          if (!this._idx.has(typeName)) {
            throw new Error("Missing type index for " + typeName);
          }
          return slebEncode(this._idx.get(typeName) || 0);
        }
      };
      Visitor = class {
        visitType(t2, data) {
          throw new Error("Not implemented");
        }
        visitPrimitive(t2, data) {
          return this.visitType(t2, data);
        }
        visitEmpty(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitBool(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitNull(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitReserved(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitText(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitNumber(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitInt(t2, data) {
          return this.visitNumber(t2, data);
        }
        visitNat(t2, data) {
          return this.visitNumber(t2, data);
        }
        visitFloat(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitFixedInt(t2, data) {
          return this.visitNumber(t2, data);
        }
        visitFixedNat(t2, data) {
          return this.visitNumber(t2, data);
        }
        visitPrincipal(t2, data) {
          return this.visitPrimitive(t2, data);
        }
        visitConstruct(t2, data) {
          return this.visitType(t2, data);
        }
        visitVec(t2, ty, data) {
          return this.visitConstruct(t2, data);
        }
        visitOpt(t2, ty, data) {
          return this.visitConstruct(t2, data);
        }
        visitRecord(t2, fields, data) {
          return this.visitConstruct(t2, data);
        }
        visitTuple(t2, components, data) {
          const fields = components.map((ty, i) => [`_${i}_`, ty]);
          return this.visitRecord(t2, fields, data);
        }
        visitVariant(t2, fields, data) {
          return this.visitConstruct(t2, data);
        }
        visitRec(t2, ty, data) {
          return this.visitConstruct(ty, data);
        }
        visitFunc(t2, data) {
          return this.visitConstruct(t2, data);
        }
        visitService(t2, data) {
          return this.visitConstruct(t2, data);
        }
      };
      Type = class {
        /* Display type name */
        display() {
          return this.name;
        }
        valueToString(x5) {
          return toReadableString(x5);
        }
        /* Implement `T` in the IDL spec, only needed for non-primitive types */
        buildTypeTable(typeTable) {
          if (!typeTable.has(this)) {
            this._buildTypeTableImpl(typeTable);
          }
        }
      };
      PrimitiveType = class extends Type {
        checkType(t2) {
          if (this.name !== t2.name) {
            throw new Error(`type mismatch: type on the wire ${t2.name}, expect type ${this.name}`);
          }
          return t2;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _buildTypeTableImpl(typeTable) {
          return;
        }
      };
      ConstructType = class extends Type {
        checkType(t2) {
          if (t2 instanceof RecClass) {
            const ty = t2.getType();
            if (typeof ty === "undefined") {
              throw new Error("type mismatch with uninitialized type");
            }
            return ty;
          }
          throw new Error(`type mismatch: type on the wire ${t2.name}, expect type ${this.name}`);
        }
        encodeType(typeTable) {
          return typeTable.indexOf(this.name);
        }
      };
      EmptyClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitEmpty(this, d2);
        }
        covariant(x5) {
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue() {
          throw new Error("Empty cannot appear as a function argument");
        }
        valueToString() {
          throw new Error("Empty cannot appear as a value");
        }
        encodeType() {
          return slebEncode(
            -17
            /* IDLTypeIds.Empty */
          );
        }
        decodeValue() {
          throw new Error("Empty cannot appear as an output");
        }
        get name() {
          return "empty";
        }
      };
      UnknownClass = class extends Type {
        checkType(t2) {
          throw new Error("Method not implemented for unknown.");
        }
        accept(v2, d2) {
          throw v2.visitType(this, d2);
        }
        covariant(x5) {
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue() {
          throw new Error("Unknown cannot appear as a function argument");
        }
        valueToString() {
          throw new Error("Unknown cannot appear as a value");
        }
        encodeType() {
          throw new Error("Unknown cannot be serialized");
        }
        decodeValue(b3, t2) {
          let decodedValue = t2.decodeValue(b3, t2);
          if (Object(decodedValue) !== decodedValue) {
            decodedValue = Object(decodedValue);
          }
          let typeFunc;
          if (t2 instanceof RecClass) {
            typeFunc = () => t2.getType();
          } else {
            typeFunc = () => t2;
          }
          Object.defineProperty(decodedValue, "type", {
            value: typeFunc,
            writable: true,
            enumerable: false,
            configurable: true
          });
          return decodedValue;
        }
        _buildTypeTableImpl() {
          throw new Error("Unknown cannot be serialized");
        }
        get name() {
          return "Unknown";
        }
      };
      BoolClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitBool(this, d2);
        }
        covariant(x5) {
          if (typeof x5 === "boolean")
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          return new Uint8Array([x5 ? 1 : 0]);
        }
        encodeType() {
          return slebEncode(
            -2
            /* IDLTypeIds.Bool */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          switch (safeReadUint8(b3)) {
            case 0:
              return false;
            case 1:
              return true;
            default:
              throw new Error("Boolean value out of range");
          }
        }
        get name() {
          return "bool";
        }
      };
      NullClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitNull(this, d2);
        }
        covariant(x5) {
          if (x5 === null)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue() {
          return new ArrayBuffer(0);
        }
        encodeType() {
          return slebEncode(
            -1
            /* IDLTypeIds.Null */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          return null;
        }
        get name() {
          return "null";
        }
      };
      ReservedClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitReserved(this, d2);
        }
        covariant(x5) {
          return true;
        }
        encodeValue() {
          return new ArrayBuffer(0);
        }
        encodeType() {
          return slebEncode(
            -16
            /* IDLTypeIds.Reserved */
          );
        }
        decodeValue(b3, t2) {
          if (t2.name !== this.name) {
            t2.decodeValue(b3, t2);
          }
          return null;
        }
        get name() {
          return "reserved";
        }
      };
      TextClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitText(this, d2);
        }
        covariant(x5) {
          if (typeof x5 === "string")
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const buf = new TextEncoder().encode(x5);
          const len = lebEncode(buf.byteLength);
          return concat2(len, buf);
        }
        encodeType() {
          return slebEncode(
            -15
            /* IDLTypeIds.Text */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          const len = lebDecode(b3);
          const buf = safeRead(b3, Number(len));
          const decoder = new TextDecoder("utf8", { fatal: true });
          return decoder.decode(buf);
        }
        get name() {
          return "text";
        }
        valueToString(x5) {
          return '"' + x5 + '"';
        }
      };
      IntClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitInt(this, d2);
        }
        covariant(x5) {
          if (typeof x5 === "bigint" || Number.isInteger(x5))
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          return slebEncode(x5);
        }
        encodeType() {
          return slebEncode(
            -4
            /* IDLTypeIds.Int */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          return slebDecode(b3);
        }
        get name() {
          return "int";
        }
        valueToString(x5) {
          return x5.toString();
        }
      };
      NatClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitNat(this, d2);
        }
        covariant(x5) {
          if (typeof x5 === "bigint" && x5 >= BigInt(0) || Number.isInteger(x5) && x5 >= 0)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          return lebEncode(x5);
        }
        encodeType() {
          return slebEncode(
            -3
            /* IDLTypeIds.Nat */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          return lebDecode(b3);
        }
        get name() {
          return "nat";
        }
        valueToString(x5) {
          return x5.toString();
        }
      };
      FloatClass = class extends PrimitiveType {
        constructor(_bits) {
          super();
          this._bits = _bits;
          if (_bits !== 32 && _bits !== 64) {
            throw new Error("not a valid float type");
          }
        }
        accept(v2, d2) {
          return v2.visitFloat(this, d2);
        }
        covariant(x5) {
          if (typeof x5 === "number" || x5 instanceof Number)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const buf = new ArrayBuffer(this._bits / 8);
          const view = new DataView(buf);
          if (this._bits === 32) {
            view.setFloat32(0, x5, true);
          } else {
            view.setFloat64(0, x5, true);
          }
          return buf;
        }
        encodeType() {
          const opcode = this._bits === 32 ? -13 : -14;
          return slebEncode(opcode);
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          const bytes = safeRead(b3, this._bits / 8);
          const view = new DataView(bytes);
          if (this._bits === 32) {
            return view.getFloat32(0, true);
          } else {
            return view.getFloat64(0, true);
          }
        }
        get name() {
          return "float" + this._bits;
        }
        valueToString(x5) {
          return x5.toString();
        }
      };
      FixedIntClass = class extends PrimitiveType {
        constructor(_bits) {
          super();
          this._bits = _bits;
        }
        accept(v2, d2) {
          return v2.visitFixedInt(this, d2);
        }
        covariant(x5) {
          const min = iexp2(this._bits - 1) * BigInt(-1);
          const max = iexp2(this._bits - 1) - BigInt(1);
          let ok = false;
          if (typeof x5 === "bigint") {
            ok = x5 >= min && x5 <= max;
          } else if (Number.isInteger(x5)) {
            const v2 = BigInt(x5);
            ok = v2 >= min && v2 <= max;
          } else {
            ok = false;
          }
          if (ok)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          return writeIntLE(x5, this._bits / 8);
        }
        encodeType() {
          const offset = Math.log2(this._bits) - 3;
          return slebEncode(-9 - offset);
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          const num = readIntLE(b3, this._bits / 8);
          if (this._bits <= 32) {
            return Number(num);
          } else {
            return num;
          }
        }
        get name() {
          return `int${this._bits}`;
        }
        valueToString(x5) {
          return x5.toString();
        }
      };
      FixedNatClass = class extends PrimitiveType {
        constructor(_bits) {
          super();
          this._bits = _bits;
        }
        accept(v2, d2) {
          return v2.visitFixedNat(this, d2);
        }
        covariant(x5) {
          const max = iexp2(this._bits);
          let ok = false;
          if (typeof x5 === "bigint" && x5 >= BigInt(0)) {
            ok = x5 < max;
          } else if (Number.isInteger(x5) && x5 >= 0) {
            const v2 = BigInt(x5);
            ok = v2 < max;
          } else {
            ok = false;
          }
          if (ok)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          return writeUIntLE(x5, this._bits / 8);
        }
        encodeType() {
          const offset = Math.log2(this._bits) - 3;
          return slebEncode(-5 - offset);
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          const num = readUIntLE(b3, this._bits / 8);
          if (this._bits <= 32) {
            return Number(num);
          } else {
            return num;
          }
        }
        get name() {
          return `nat${this._bits}`;
        }
        valueToString(x5) {
          return x5.toString();
        }
      };
      VecClass = class _VecClass extends ConstructType {
        constructor(_type) {
          super();
          this._type = _type;
          this._blobOptimization = false;
          if (_type instanceof FixedNatClass && _type._bits === 8) {
            this._blobOptimization = true;
          }
        }
        accept(v2, d2) {
          return v2.visitVec(this, this._type, d2);
        }
        covariant(x5) {
          const bits = this._type instanceof FixedNatClass ? this._type._bits : this._type instanceof FixedIntClass ? this._type._bits : 0;
          if (ArrayBuffer.isView(x5) && bits == x5.BYTES_PER_ELEMENT * 8 || Array.isArray(x5) && x5.every((v2, idx) => {
            try {
              return this._type.covariant(v2);
            } catch (e3) {
              throw new Error(`Invalid ${this.display()} argument: 

index ${idx} -> ${e3.message}`);
            }
          }))
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const len = lebEncode(x5.length);
          if (this._blobOptimization) {
            return concat2(len, new Uint8Array(x5));
          }
          if (ArrayBuffer.isView(x5)) {
            return concat2(len, new Uint8Array(x5.buffer));
          }
          const buf = new PipeArrayBuffer(new ArrayBuffer(len.byteLength + x5.length), 0);
          buf.write(len);
          for (const d2 of x5) {
            const encoded = this._type.encodeValue(d2);
            buf.write(new Uint8Array(encoded));
          }
          return buf.buffer;
        }
        _buildTypeTableImpl(typeTable) {
          this._type.buildTypeTable(typeTable);
          const opCode = slebEncode(
            -19
            /* IDLTypeIds.Vector */
          );
          const buffer = this._type.encodeType(typeTable);
          typeTable.add(this, concat2(opCode, buffer));
        }
        decodeValue(b3, t2) {
          const vec = this.checkType(t2);
          if (!(vec instanceof _VecClass)) {
            throw new Error("Not a vector type");
          }
          const len = Number(lebDecode(b3));
          if (this._type instanceof FixedNatClass) {
            if (this._type._bits == 8) {
              return new Uint8Array(b3.read(len));
            }
            if (this._type._bits == 16) {
              return new Uint16Array(b3.read(len * 2));
            }
            if (this._type._bits == 32) {
              return new Uint32Array(b3.read(len * 4));
            }
            if (this._type._bits == 64) {
              return new BigUint64Array(b3.read(len * 8));
            }
          }
          if (this._type instanceof FixedIntClass) {
            if (this._type._bits == 8) {
              return new Int8Array(b3.read(len));
            }
            if (this._type._bits == 16) {
              return new Int16Array(b3.read(len * 2));
            }
            if (this._type._bits == 32) {
              return new Int32Array(b3.read(len * 4));
            }
            if (this._type._bits == 64) {
              return new BigInt64Array(b3.read(len * 8));
            }
          }
          const rets = [];
          for (let i = 0; i < len; i++) {
            rets.push(this._type.decodeValue(b3, vec._type));
          }
          return rets;
        }
        get name() {
          return `vec ${this._type.name}`;
        }
        display() {
          return `vec ${this._type.display()}`;
        }
        valueToString(x5) {
          const elements = x5.map((e3) => this._type.valueToString(e3));
          return "vec {" + elements.join("; ") + "}";
        }
      };
      OptClass = class _OptClass extends ConstructType {
        constructor(_type) {
          super();
          this._type = _type;
        }
        accept(v2, d2) {
          return v2.visitOpt(this, this._type, d2);
        }
        covariant(x5) {
          try {
            if (Array.isArray(x5) && (x5.length === 0 || x5.length === 1 && this._type.covariant(x5[0])))
              return true;
          } catch (e3) {
            throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)} 

-> ${e3.message}`);
          }
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          if (x5.length === 0) {
            return new Uint8Array([0]);
          } else {
            return concat2(new Uint8Array([1]), this._type.encodeValue(x5[0]));
          }
        }
        _buildTypeTableImpl(typeTable) {
          this._type.buildTypeTable(typeTable);
          const opCode = slebEncode(
            -18
            /* IDLTypeIds.Opt */
          );
          const buffer = this._type.encodeType(typeTable);
          typeTable.add(this, concat2(opCode, buffer));
        }
        decodeValue(b3, t2) {
          const opt = this.checkType(t2);
          if (!(opt instanceof _OptClass)) {
            throw new Error("Not an option type");
          }
          switch (safeReadUint8(b3)) {
            case 0:
              return [];
            case 1:
              return [this._type.decodeValue(b3, opt._type)];
            default:
              throw new Error("Not an option value");
          }
        }
        get name() {
          return `opt ${this._type.name}`;
        }
        display() {
          return `opt ${this._type.display()}`;
        }
        valueToString(x5) {
          if (x5.length === 0) {
            return "null";
          } else {
            return `opt ${this._type.valueToString(x5[0])}`;
          }
        }
      };
      RecordClass = class _RecordClass extends ConstructType {
        constructor(fields = {}) {
          super();
          this._fields = Object.entries(fields).sort((a, b3) => idlLabelToId(a[0]) - idlLabelToId(b3[0]));
        }
        accept(v2, d2) {
          return v2.visitRecord(this, this._fields, d2);
        }
        tryAsTuple() {
          const res = [];
          for (let i = 0; i < this._fields.length; i++) {
            const [key, type] = this._fields[i];
            if (key !== `_${i}_`) {
              return null;
            }
            res.push(type);
          }
          return res;
        }
        covariant(x5) {
          if (typeof x5 === "object" && this._fields.every(([k2, t2]) => {
            if (!x5.hasOwnProperty(k2)) {
              throw new Error(`Record is missing key "${k2}".`);
            }
            try {
              return t2.covariant(x5[k2]);
            } catch (e3) {
              throw new Error(`Invalid ${this.display()} argument: 

field ${k2} -> ${e3.message}`);
            }
          }))
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const values = this._fields.map(([key]) => x5[key]);
          const bufs = zipWith(this._fields, values, ([, c3], d2) => c3.encodeValue(d2));
          return concat2(...bufs);
        }
        _buildTypeTableImpl(T3) {
          this._fields.forEach(([_2, value4]) => value4.buildTypeTable(T3));
          const opCode = slebEncode(
            -20
            /* IDLTypeIds.Record */
          );
          const len = lebEncode(this._fields.length);
          const fields = this._fields.map(([key, value4]) => concat2(lebEncode(idlLabelToId(key)), value4.encodeType(T3)));
          T3.add(this, concat2(opCode, len, concat2(...fields)));
        }
        decodeValue(b3, t2) {
          const record = this.checkType(t2);
          if (!(record instanceof _RecordClass)) {
            throw new Error("Not a record type");
          }
          const x5 = {};
          let expectedRecordIdx = 0;
          let actualRecordIdx = 0;
          while (actualRecordIdx < record._fields.length) {
            const [hash2, type] = record._fields[actualRecordIdx];
            if (expectedRecordIdx >= this._fields.length) {
              type.decodeValue(b3, type);
              actualRecordIdx++;
              continue;
            }
            const [expectKey, expectType] = this._fields[expectedRecordIdx];
            const expectedId = idlLabelToId(this._fields[expectedRecordIdx][0]);
            const actualId = idlLabelToId(hash2);
            if (expectedId === actualId) {
              x5[expectKey] = expectType.decodeValue(b3, type);
              expectedRecordIdx++;
              actualRecordIdx++;
            } else if (actualId > expectedId) {
              if (expectType instanceof OptClass || expectType instanceof ReservedClass) {
                x5[expectKey] = [];
                expectedRecordIdx++;
              } else {
                throw new Error("Cannot find required field " + expectKey);
              }
            } else {
              type.decodeValue(b3, type);
              actualRecordIdx++;
            }
          }
          for (const [expectKey, expectType] of this._fields.slice(expectedRecordIdx)) {
            if (expectType instanceof OptClass || expectType instanceof ReservedClass) {
              x5[expectKey] = [];
            } else {
              throw new Error("Cannot find required field " + expectKey);
            }
          }
          return x5;
        }
        get name() {
          const fields = this._fields.map(([key, value4]) => key + ":" + value4.name);
          return `record {${fields.join("; ")}}`;
        }
        display() {
          const fields = this._fields.map(([key, value4]) => key + ":" + value4.display());
          return `record {${fields.join("; ")}}`;
        }
        valueToString(x5) {
          const values = this._fields.map(([key]) => x5[key]);
          const fields = zipWith(this._fields, values, ([k2, c3], d2) => k2 + "=" + c3.valueToString(d2));
          return `record {${fields.join("; ")}}`;
        }
      };
      TupleClass = class _TupleClass extends RecordClass {
        constructor(_components) {
          const x5 = {};
          _components.forEach((e3, i) => x5["_" + i + "_"] = e3);
          super(x5);
          this._components = _components;
        }
        accept(v2, d2) {
          return v2.visitTuple(this, this._components, d2);
        }
        covariant(x5) {
          if (Array.isArray(x5) && x5.length >= this._fields.length && this._components.every((t2, i) => {
            try {
              return t2.covariant(x5[i]);
            } catch (e3) {
              throw new Error(`Invalid ${this.display()} argument: 

index ${i} -> ${e3.message}`);
            }
          }))
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const bufs = zipWith(this._components, x5, (c3, d2) => c3.encodeValue(d2));
          return concat2(...bufs);
        }
        decodeValue(b3, t2) {
          const tuple = this.checkType(t2);
          if (!(tuple instanceof _TupleClass)) {
            throw new Error("not a tuple type");
          }
          if (tuple._components.length < this._components.length) {
            throw new Error("tuple mismatch");
          }
          const res = [];
          for (const [i, wireType] of tuple._components.entries()) {
            if (i >= this._components.length) {
              wireType.decodeValue(b3, wireType);
            } else {
              res.push(this._components[i].decodeValue(b3, wireType));
            }
          }
          return res;
        }
        display() {
          const fields = this._components.map((value4) => value4.display());
          return `record {${fields.join("; ")}}`;
        }
        valueToString(values) {
          const fields = zipWith(this._components, values, (c3, d2) => c3.valueToString(d2));
          return `record {${fields.join("; ")}}`;
        }
      };
      VariantClass = class _VariantClass extends ConstructType {
        constructor(fields = {}) {
          super();
          this._fields = Object.entries(fields).sort((a, b3) => idlLabelToId(a[0]) - idlLabelToId(b3[0]));
        }
        accept(v2, d2) {
          return v2.visitVariant(this, this._fields, d2);
        }
        covariant(x5) {
          if (typeof x5 === "object" && Object.entries(x5).length === 1 && this._fields.every(([k2, v2]) => {
            try {
              return !x5.hasOwnProperty(k2) || v2.covariant(x5[k2]);
            } catch (e3) {
              throw new Error(`Invalid ${this.display()} argument: 

variant ${k2} -> ${e3.message}`);
            }
          }))
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          for (let i = 0; i < this._fields.length; i++) {
            const [name, type] = this._fields[i];
            if (x5.hasOwnProperty(name)) {
              const idx = lebEncode(i);
              const buf = type.encodeValue(x5[name]);
              return concat2(idx, buf);
            }
          }
          throw Error("Variant has no data: " + x5);
        }
        _buildTypeTableImpl(typeTable) {
          this._fields.forEach(([, type]) => {
            type.buildTypeTable(typeTable);
          });
          const opCode = slebEncode(
            -21
            /* IDLTypeIds.Variant */
          );
          const len = lebEncode(this._fields.length);
          const fields = this._fields.map(([key, value4]) => concat2(lebEncode(idlLabelToId(key)), value4.encodeType(typeTable)));
          typeTable.add(this, concat2(opCode, len, ...fields));
        }
        decodeValue(b3, t2) {
          const variant = this.checkType(t2);
          if (!(variant instanceof _VariantClass)) {
            throw new Error("Not a variant type");
          }
          const idx = Number(lebDecode(b3));
          if (idx >= variant._fields.length) {
            throw Error("Invalid variant index: " + idx);
          }
          const [wireHash, wireType] = variant._fields[idx];
          for (const [key, expectType] of this._fields) {
            if (idlLabelToId(wireHash) === idlLabelToId(key)) {
              const value4 = expectType.decodeValue(b3, wireType);
              return { [key]: value4 };
            }
          }
          throw new Error("Cannot find field hash " + wireHash);
        }
        get name() {
          const fields = this._fields.map(([key, type]) => key + ":" + type.name);
          return `variant {${fields.join("; ")}}`;
        }
        display() {
          const fields = this._fields.map(([key, type]) => key + (type.name === "null" ? "" : `:${type.display()}`));
          return `variant {${fields.join("; ")}}`;
        }
        valueToString(x5) {
          for (const [name, type] of this._fields) {
            if (x5.hasOwnProperty(name)) {
              const value4 = type.valueToString(x5[name]);
              if (value4 === "null") {
                return `variant {${name}}`;
              } else {
                return `variant {${name}=${value4}}`;
              }
            }
          }
          throw new Error("Variant has no data: " + x5);
        }
      };
      RecClass = class _RecClass extends ConstructType {
        constructor() {
          super(...arguments);
          this._id = _RecClass._counter++;
          this._type = void 0;
        }
        accept(v2, d2) {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          return v2.visitRec(this, this._type, d2);
        }
        fill(t2) {
          this._type = t2;
        }
        getType() {
          return this._type;
        }
        covariant(x5) {
          if (this._type ? this._type.covariant(x5) : false)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          return this._type.encodeValue(x5);
        }
        _buildTypeTableImpl(typeTable) {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          typeTable.add(this, new Uint8Array([]));
          this._type.buildTypeTable(typeTable);
          typeTable.merge(this, this._type.name);
        }
        decodeValue(b3, t2) {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          return this._type.decodeValue(b3, t2);
        }
        get name() {
          return `rec_${this._id}`;
        }
        display() {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          return `\u03BC${this.name}.${this._type.name}`;
        }
        valueToString(x5) {
          if (!this._type) {
            throw Error("Recursive type uninitialized.");
          }
          return this._type.valueToString(x5);
        }
      };
      RecClass._counter = 0;
      PrincipalClass = class extends PrimitiveType {
        accept(v2, d2) {
          return v2.visitPrincipal(this, d2);
        }
        covariant(x5) {
          if (x5 && x5._isPrincipal)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const buf = x5.toUint8Array();
          const len = lebEncode(buf.byteLength);
          return concat2(new Uint8Array([1]), len, buf);
        }
        encodeType() {
          return slebEncode(
            -24
            /* IDLTypeIds.Principal */
          );
        }
        decodeValue(b3, t2) {
          this.checkType(t2);
          return decodePrincipalId(b3);
        }
        get name() {
          return "principal";
        }
        valueToString(x5) {
          return `${this.name} "${x5.toText()}"`;
        }
      };
      FuncClass = class extends ConstructType {
        constructor(argTypes, retTypes, annotations = []) {
          super();
          this.argTypes = argTypes;
          this.retTypes = retTypes;
          this.annotations = annotations;
        }
        static argsToString(types, v2) {
          if (types.length !== v2.length) {
            throw new Error("arity mismatch");
          }
          return "(" + types.map((t2, i) => t2.valueToString(v2[i])).join(", ") + ")";
        }
        accept(v2, d2) {
          return v2.visitFunc(this, d2);
        }
        covariant(x5) {
          if (Array.isArray(x5) && x5.length === 2 && x5[0] && x5[0]._isPrincipal && typeof x5[1] === "string")
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue([principal, methodName]) {
          const buf = principal.toUint8Array();
          const len = lebEncode(buf.byteLength);
          const canister = concat2(new Uint8Array([1]), len, buf);
          const method = new TextEncoder().encode(methodName);
          const methodLen = lebEncode(method.byteLength);
          return concat2(new Uint8Array([1]), canister, methodLen, method);
        }
        _buildTypeTableImpl(T3) {
          this.argTypes.forEach((arg) => arg.buildTypeTable(T3));
          this.retTypes.forEach((arg) => arg.buildTypeTable(T3));
          const opCode = slebEncode(
            -22
            /* IDLTypeIds.Func */
          );
          const argLen = lebEncode(this.argTypes.length);
          const args = concat2(...this.argTypes.map((arg) => arg.encodeType(T3)));
          const retLen = lebEncode(this.retTypes.length);
          const rets = concat2(...this.retTypes.map((arg) => arg.encodeType(T3)));
          const annLen = lebEncode(this.annotations.length);
          const anns = concat2(...this.annotations.map((a) => this.encodeAnnotation(a)));
          T3.add(this, concat2(opCode, argLen, args, retLen, rets, annLen, anns));
        }
        decodeValue(b3) {
          const x5 = safeReadUint8(b3);
          if (x5 !== 1) {
            throw new Error("Cannot decode function reference");
          }
          const canister = decodePrincipalId(b3);
          const mLen = Number(lebDecode(b3));
          const buf = safeRead(b3, mLen);
          const decoder = new TextDecoder("utf8", { fatal: true });
          const method = decoder.decode(buf);
          return [canister, method];
        }
        get name() {
          const args = this.argTypes.map((arg) => arg.name).join(", ");
          const rets = this.retTypes.map((arg) => arg.name).join(", ");
          const annon = " " + this.annotations.join(" ");
          return `(${args}) -> (${rets})${annon}`;
        }
        valueToString([principal, str]) {
          return `func "${principal.toText()}".${str}`;
        }
        display() {
          const args = this.argTypes.map((arg) => arg.display()).join(", ");
          const rets = this.retTypes.map((arg) => arg.display()).join(", ");
          const annon = " " + this.annotations.join(" ");
          return `(${args}) \u2192 (${rets})${annon}`;
        }
        encodeAnnotation(ann) {
          if (ann === "query") {
            return new Uint8Array([1]);
          } else if (ann === "oneway") {
            return new Uint8Array([2]);
          } else if (ann === "composite_query") {
            return new Uint8Array([3]);
          } else {
            throw new Error("Illegal function annotation");
          }
        }
      };
      ServiceClass = class extends ConstructType {
        constructor(fields) {
          super();
          this._fields = Object.entries(fields).sort((a, b3) => {
            if (a[0] < b3[0]) {
              return -1;
            }
            if (a[0] > b3[0]) {
              return 1;
            }
            return 0;
          });
        }
        accept(v2, d2) {
          return v2.visitService(this, d2);
        }
        covariant(x5) {
          if (x5 && x5._isPrincipal)
            return true;
          throw new Error(`Invalid ${this.display()} argument: ${toReadableString(x5)}`);
        }
        encodeValue(x5) {
          const buf = x5.toUint8Array();
          const len = lebEncode(buf.length);
          return concat2(new Uint8Array([1]), len, buf);
        }
        _buildTypeTableImpl(T3) {
          this._fields.forEach(([_2, func]) => func.buildTypeTable(T3));
          const opCode = slebEncode(
            -23
            /* IDLTypeIds.Service */
          );
          const len = lebEncode(this._fields.length);
          const meths = this._fields.map(([label, func]) => {
            const labelBuf = new TextEncoder().encode(label);
            const labelLen = lebEncode(labelBuf.length);
            return concat2(labelLen, labelBuf, func.encodeType(T3));
          });
          T3.add(this, concat2(opCode, len, ...meths));
        }
        decodeValue(b3) {
          return decodePrincipalId(b3);
        }
        get name() {
          const fields = this._fields.map(([key, value4]) => key + ":" + value4.name);
          return `service {${fields.join("; ")}}`;
        }
        valueToString(x5) {
          return `service "${x5.toText()}"`;
        }
      };
      Empty = new EmptyClass();
      Reserved = new ReservedClass();
      Unknown = new UnknownClass();
      Bool = new BoolClass();
      Null = new NullClass();
      Text = new TextClass();
      Int = new IntClass();
      Nat = new NatClass();
      Float32 = new FloatClass(32);
      Float64 = new FloatClass(64);
      Int8 = new FixedIntClass(8);
      Int16 = new FixedIntClass(16);
      Int32 = new FixedIntClass(32);
      Int64 = new FixedIntClass(64);
      Nat8 = new FixedNatClass(8);
      Nat16 = new FixedNatClass(16);
      Nat32 = new FixedNatClass(32);
      Nat64 = new FixedNatClass(64);
      Principal2 = new PrincipalClass();
    }
  });

  // node_modules/@dfinity/candid/lib/esm/candid-core.js
  var init_candid_core = __esm({
    "node_modules/@dfinity/candid/lib/esm/candid-core.js"() {
    }
  });

  // node_modules/@dfinity/candid/lib/esm/candid-ui.js
  var init_candid_ui = __esm({
    "node_modules/@dfinity/candid/lib/esm/candid-ui.js"() {
      init_idl();
      init_esm();
      init_candid_core();
    }
  });

  // node_modules/@dfinity/candid/lib/esm/types.js
  var init_types = __esm({
    "node_modules/@dfinity/candid/lib/esm/types.js"() {
    }
  });

  // node_modules/@dfinity/candid/lib/esm/index.js
  var init_esm2 = __esm({
    "node_modules/@dfinity/candid/lib/esm/index.js"() {
      init_candid_ui();
      init_candid_core();
      init_idl();
      init_hash();
      init_leb128();
      init_buffer2();
      init_types();
    }
  });

  // node_modules/borc/node_modules/buffer/index.js
  var require_buffer2 = __commonJS({
    "node_modules/borc/node_modules/buffer/index.js"(exports) {
      "use strict";
      var base64 = require_base64_js();
      var ieee754 = require_ieee754();
      var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
      exports.Buffer = Buffer3;
      exports.SlowBuffer = SlowBuffer;
      exports.INSPECT_MAX_BYTES = 50;
      var K_MAX_LENGTH = 2147483647;
      exports.kMaxLength = K_MAX_LENGTH;
      Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
      if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
        console.error(
          "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
        );
      }
      function typedArraySupport() {
        try {
          var arr = new Uint8Array(1);
          var proto = { foo: function() {
            return 42;
          } };
          Object.setPrototypeOf(proto, Uint8Array.prototype);
          Object.setPrototypeOf(arr, proto);
          return arr.foo() === 42;
        } catch (e3) {
          return false;
        }
      }
      Object.defineProperty(Buffer3.prototype, "parent", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this))
            return void 0;
          return this.buffer;
        }
      });
      Object.defineProperty(Buffer3.prototype, "offset", {
        enumerable: true,
        get: function() {
          if (!Buffer3.isBuffer(this))
            return void 0;
          return this.byteOffset;
        }
      });
      function createBuffer(length) {
        if (length > K_MAX_LENGTH) {
          throw new RangeError('The value "' + length + '" is invalid for option "size"');
        }
        var buf = new Uint8Array(length);
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function Buffer3(arg, encodingOrOffset, length) {
        if (typeof arg === "number") {
          if (typeof encodingOrOffset === "string") {
            throw new TypeError(
              'The "string" argument must be of type string. Received type number'
            );
          }
          return allocUnsafe(arg);
        }
        return from(arg, encodingOrOffset, length);
      }
      Buffer3.poolSize = 8192;
      function from(value4, encodingOrOffset, length) {
        if (typeof value4 === "string") {
          return fromString(value4, encodingOrOffset);
        }
        if (ArrayBuffer.isView(value4)) {
          return fromArrayView(value4);
        }
        if (value4 == null) {
          throw new TypeError(
            "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value4
          );
        }
        if (isInstance(value4, ArrayBuffer) || value4 && isInstance(value4.buffer, ArrayBuffer)) {
          return fromArrayBuffer(value4, encodingOrOffset, length);
        }
        if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value4, SharedArrayBuffer) || value4 && isInstance(value4.buffer, SharedArrayBuffer))) {
          return fromArrayBuffer(value4, encodingOrOffset, length);
        }
        if (typeof value4 === "number") {
          throw new TypeError(
            'The "value" argument must not be of type number. Received type number'
          );
        }
        var valueOf = value4.valueOf && value4.valueOf();
        if (valueOf != null && valueOf !== value4) {
          return Buffer3.from(valueOf, encodingOrOffset, length);
        }
        var b3 = fromObject(value4);
        if (b3)
          return b3;
        if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value4[Symbol.toPrimitive] === "function") {
          return Buffer3.from(
            value4[Symbol.toPrimitive]("string"),
            encodingOrOffset,
            length
          );
        }
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value4
        );
      }
      Buffer3.from = function(value4, encodingOrOffset, length) {
        return from(value4, encodingOrOffset, length);
      };
      Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
      Object.setPrototypeOf(Buffer3, Uint8Array);
      function assertSize(size) {
        if (typeof size !== "number") {
          throw new TypeError('"size" argument must be of type number');
        } else if (size < 0) {
          throw new RangeError('The value "' + size + '" is invalid for option "size"');
        }
      }
      function alloc(size, fill, encoding) {
        assertSize(size);
        if (size <= 0) {
          return createBuffer(size);
        }
        if (fill !== void 0) {
          return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
        }
        return createBuffer(size);
      }
      Buffer3.alloc = function(size, fill, encoding) {
        return alloc(size, fill, encoding);
      };
      function allocUnsafe(size) {
        assertSize(size);
        return createBuffer(size < 0 ? 0 : checked(size) | 0);
      }
      Buffer3.allocUnsafe = function(size) {
        return allocUnsafe(size);
      };
      Buffer3.allocUnsafeSlow = function(size) {
        return allocUnsafe(size);
      };
      function fromString(string, encoding) {
        if (typeof encoding !== "string" || encoding === "") {
          encoding = "utf8";
        }
        if (!Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        var length = byteLength(string, encoding) | 0;
        var buf = createBuffer(length);
        var actual = buf.write(string, encoding);
        if (actual !== length) {
          buf = buf.slice(0, actual);
        }
        return buf;
      }
      function fromArrayLike(array) {
        var length = array.length < 0 ? 0 : checked(array.length) | 0;
        var buf = createBuffer(length);
        for (var i = 0; i < length; i += 1) {
          buf[i] = array[i] & 255;
        }
        return buf;
      }
      function fromArrayView(arrayView) {
        if (isInstance(arrayView, Uint8Array)) {
          var copy = new Uint8Array(arrayView);
          return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
        }
        return fromArrayLike(arrayView);
      }
      function fromArrayBuffer(array, byteOffset, length) {
        if (byteOffset < 0 || array.byteLength < byteOffset) {
          throw new RangeError('"offset" is outside of buffer bounds');
        }
        if (array.byteLength < byteOffset + (length || 0)) {
          throw new RangeError('"length" is outside of buffer bounds');
        }
        var buf;
        if (byteOffset === void 0 && length === void 0) {
          buf = new Uint8Array(array);
        } else if (length === void 0) {
          buf = new Uint8Array(array, byteOffset);
        } else {
          buf = new Uint8Array(array, byteOffset, length);
        }
        Object.setPrototypeOf(buf, Buffer3.prototype);
        return buf;
      }
      function fromObject(obj) {
        if (Buffer3.isBuffer(obj)) {
          var len = checked(obj.length) | 0;
          var buf = createBuffer(len);
          if (buf.length === 0) {
            return buf;
          }
          obj.copy(buf, 0, 0, len);
          return buf;
        }
        if (obj.length !== void 0) {
          if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
            return createBuffer(0);
          }
          return fromArrayLike(obj);
        }
        if (obj.type === "Buffer" && Array.isArray(obj.data)) {
          return fromArrayLike(obj.data);
        }
      }
      function checked(length) {
        if (length >= K_MAX_LENGTH) {
          throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
        }
        return length | 0;
      }
      function SlowBuffer(length) {
        if (+length != length) {
          length = 0;
        }
        return Buffer3.alloc(+length);
      }
      Buffer3.isBuffer = function isBuffer(b3) {
        return b3 != null && b3._isBuffer === true && b3 !== Buffer3.prototype;
      };
      Buffer3.compare = function compare2(a, b3) {
        if (isInstance(a, Uint8Array))
          a = Buffer3.from(a, a.offset, a.byteLength);
        if (isInstance(b3, Uint8Array))
          b3 = Buffer3.from(b3, b3.offset, b3.byteLength);
        if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b3)) {
          throw new TypeError(
            'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
          );
        }
        if (a === b3)
          return 0;
        var x5 = a.length;
        var y = b3.length;
        for (var i = 0, len = Math.min(x5, y); i < len; ++i) {
          if (a[i] !== b3[i]) {
            x5 = a[i];
            y = b3[i];
            break;
          }
        }
        if (x5 < y)
          return -1;
        if (y < x5)
          return 1;
        return 0;
      };
      Buffer3.isEncoding = function isEncoding(encoding) {
        switch (String(encoding).toLowerCase()) {
          case "hex":
          case "utf8":
          case "utf-8":
          case "ascii":
          case "latin1":
          case "binary":
          case "base64":
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return true;
          default:
            return false;
        }
      };
      Buffer3.concat = function concat3(list, length) {
        if (!Array.isArray(list)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        }
        if (list.length === 0) {
          return Buffer3.alloc(0);
        }
        var i;
        if (length === void 0) {
          length = 0;
          for (i = 0; i < list.length; ++i) {
            length += list[i].length;
          }
        }
        var buffer = Buffer3.allocUnsafe(length);
        var pos = 0;
        for (i = 0; i < list.length; ++i) {
          var buf = list[i];
          if (isInstance(buf, Uint8Array)) {
            if (pos + buf.length > buffer.length) {
              Buffer3.from(buf).copy(buffer, pos);
            } else {
              Uint8Array.prototype.set.call(
                buffer,
                buf,
                pos
              );
            }
          } else if (!Buffer3.isBuffer(buf)) {
            throw new TypeError('"list" argument must be an Array of Buffers');
          } else {
            buf.copy(buffer, pos);
          }
          pos += buf.length;
        }
        return buffer;
      };
      function byteLength(string, encoding) {
        if (Buffer3.isBuffer(string)) {
          return string.length;
        }
        if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
          return string.byteLength;
        }
        if (typeof string !== "string") {
          throw new TypeError(
            'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
          );
        }
        var len = string.length;
        var mustMatch = arguments.length > 2 && arguments[2] === true;
        if (!mustMatch && len === 0)
          return 0;
        var loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "ascii":
            case "latin1":
            case "binary":
              return len;
            case "utf8":
            case "utf-8":
              return utf8ToBytes3(string).length;
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return len * 2;
            case "hex":
              return len >>> 1;
            case "base64":
              return base64ToBytes(string).length;
            default:
              if (loweredCase) {
                return mustMatch ? -1 : utf8ToBytes3(string).length;
              }
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.byteLength = byteLength;
      function slowToString(encoding, start, end) {
        var loweredCase = false;
        if (start === void 0 || start < 0) {
          start = 0;
        }
        if (start > this.length) {
          return "";
        }
        if (end === void 0 || end > this.length) {
          end = this.length;
        }
        if (end <= 0) {
          return "";
        }
        end >>>= 0;
        start >>>= 0;
        if (end <= start) {
          return "";
        }
        if (!encoding)
          encoding = "utf8";
        while (true) {
          switch (encoding) {
            case "hex":
              return hexSlice(this, start, end);
            case "utf8":
            case "utf-8":
              return utf8Slice(this, start, end);
            case "ascii":
              return asciiSlice(this, start, end);
            case "latin1":
            case "binary":
              return latin1Slice(this, start, end);
            case "base64":
              return base64Slice(this, start, end);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return utf16leSlice(this, start, end);
            default:
              if (loweredCase)
                throw new TypeError("Unknown encoding: " + encoding);
              encoding = (encoding + "").toLowerCase();
              loweredCase = true;
          }
        }
      }
      Buffer3.prototype._isBuffer = true;
      function swap(b3, n2, m3) {
        var i = b3[n2];
        b3[n2] = b3[m3];
        b3[m3] = i;
      }
      Buffer3.prototype.swap16 = function swap16() {
        var len = this.length;
        if (len % 2 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 16-bits");
        }
        for (var i = 0; i < len; i += 2) {
          swap(this, i, i + 1);
        }
        return this;
      };
      Buffer3.prototype.swap32 = function swap32() {
        var len = this.length;
        if (len % 4 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 32-bits");
        }
        for (var i = 0; i < len; i += 4) {
          swap(this, i, i + 3);
          swap(this, i + 1, i + 2);
        }
        return this;
      };
      Buffer3.prototype.swap64 = function swap64() {
        var len = this.length;
        if (len % 8 !== 0) {
          throw new RangeError("Buffer size must be a multiple of 64-bits");
        }
        for (var i = 0; i < len; i += 8) {
          swap(this, i, i + 7);
          swap(this, i + 1, i + 6);
          swap(this, i + 2, i + 5);
          swap(this, i + 3, i + 4);
        }
        return this;
      };
      Buffer3.prototype.toString = function toString() {
        var length = this.length;
        if (length === 0)
          return "";
        if (arguments.length === 0)
          return utf8Slice(this, 0, length);
        return slowToString.apply(this, arguments);
      };
      Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
      Buffer3.prototype.equals = function equals(b3) {
        if (!Buffer3.isBuffer(b3))
          throw new TypeError("Argument must be a Buffer");
        if (this === b3)
          return true;
        return Buffer3.compare(this, b3) === 0;
      };
      Buffer3.prototype.inspect = function inspect() {
        var str = "";
        var max = exports.INSPECT_MAX_BYTES;
        str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
        if (this.length > max)
          str += " ... ";
        return "<Buffer " + str + ">";
      };
      if (customInspectSymbol) {
        Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
      }
      Buffer3.prototype.compare = function compare2(target, start, end, thisStart, thisEnd) {
        if (isInstance(target, Uint8Array)) {
          target = Buffer3.from(target, target.offset, target.byteLength);
        }
        if (!Buffer3.isBuffer(target)) {
          throw new TypeError(
            'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
          );
        }
        if (start === void 0) {
          start = 0;
        }
        if (end === void 0) {
          end = target ? target.length : 0;
        }
        if (thisStart === void 0) {
          thisStart = 0;
        }
        if (thisEnd === void 0) {
          thisEnd = this.length;
        }
        if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
          throw new RangeError("out of range index");
        }
        if (thisStart >= thisEnd && start >= end) {
          return 0;
        }
        if (thisStart >= thisEnd) {
          return -1;
        }
        if (start >= end) {
          return 1;
        }
        start >>>= 0;
        end >>>= 0;
        thisStart >>>= 0;
        thisEnd >>>= 0;
        if (this === target)
          return 0;
        var x5 = thisEnd - thisStart;
        var y = end - start;
        var len = Math.min(x5, y);
        var thisCopy = this.slice(thisStart, thisEnd);
        var targetCopy = target.slice(start, end);
        for (var i = 0; i < len; ++i) {
          if (thisCopy[i] !== targetCopy[i]) {
            x5 = thisCopy[i];
            y = targetCopy[i];
            break;
          }
        }
        if (x5 < y)
          return -1;
        if (y < x5)
          return 1;
        return 0;
      };
      function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
        if (buffer.length === 0)
          return -1;
        if (typeof byteOffset === "string") {
          encoding = byteOffset;
          byteOffset = 0;
        } else if (byteOffset > 2147483647) {
          byteOffset = 2147483647;
        } else if (byteOffset < -2147483648) {
          byteOffset = -2147483648;
        }
        byteOffset = +byteOffset;
        if (numberIsNaN(byteOffset)) {
          byteOffset = dir ? 0 : buffer.length - 1;
        }
        if (byteOffset < 0)
          byteOffset = buffer.length + byteOffset;
        if (byteOffset >= buffer.length) {
          if (dir)
            return -1;
          else
            byteOffset = buffer.length - 1;
        } else if (byteOffset < 0) {
          if (dir)
            byteOffset = 0;
          else
            return -1;
        }
        if (typeof val === "string") {
          val = Buffer3.from(val, encoding);
        }
        if (Buffer3.isBuffer(val)) {
          if (val.length === 0) {
            return -1;
          }
          return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
        } else if (typeof val === "number") {
          val = val & 255;
          if (typeof Uint8Array.prototype.indexOf === "function") {
            if (dir) {
              return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
            } else {
              return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
            }
          }
          return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
        }
        throw new TypeError("val must be string, number or Buffer");
      }
      function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
        var indexSize = 1;
        var arrLength = arr.length;
        var valLength = val.length;
        if (encoding !== void 0) {
          encoding = String(encoding).toLowerCase();
          if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
            if (arr.length < 2 || val.length < 2) {
              return -1;
            }
            indexSize = 2;
            arrLength /= 2;
            valLength /= 2;
            byteOffset /= 2;
          }
        }
        function read(buf, i2) {
          if (indexSize === 1) {
            return buf[i2];
          } else {
            return buf.readUInt16BE(i2 * indexSize);
          }
        }
        var i;
        if (dir) {
          var foundIndex = -1;
          for (i = byteOffset; i < arrLength; i++) {
            if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
              if (foundIndex === -1)
                foundIndex = i;
              if (i - foundIndex + 1 === valLength)
                return foundIndex * indexSize;
            } else {
              if (foundIndex !== -1)
                i -= i - foundIndex;
              foundIndex = -1;
            }
          }
        } else {
          if (byteOffset + valLength > arrLength)
            byteOffset = arrLength - valLength;
          for (i = byteOffset; i >= 0; i--) {
            var found = true;
            for (var j2 = 0; j2 < valLength; j2++) {
              if (read(arr, i + j2) !== read(val, j2)) {
                found = false;
                break;
              }
            }
            if (found)
              return i;
          }
        }
        return -1;
      }
      Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
        return this.indexOf(val, byteOffset, encoding) !== -1;
      };
      Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
      };
      Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
        return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
      };
      function hexWrite(buf, string, offset, length) {
        offset = Number(offset) || 0;
        var remaining = buf.length - offset;
        if (!length) {
          length = remaining;
        } else {
          length = Number(length);
          if (length > remaining) {
            length = remaining;
          }
        }
        var strLen = string.length;
        if (length > strLen / 2) {
          length = strLen / 2;
        }
        for (var i = 0; i < length; ++i) {
          var parsed = parseInt(string.substr(i * 2, 2), 16);
          if (numberIsNaN(parsed))
            return i;
          buf[offset + i] = parsed;
        }
        return i;
      }
      function utf8Write(buf, string, offset, length) {
        return blitBuffer(utf8ToBytes3(string, buf.length - offset), buf, offset, length);
      }
      function asciiWrite(buf, string, offset, length) {
        return blitBuffer(asciiToBytes(string), buf, offset, length);
      }
      function base64Write(buf, string, offset, length) {
        return blitBuffer(base64ToBytes(string), buf, offset, length);
      }
      function ucs2Write(buf, string, offset, length) {
        return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
      }
      Buffer3.prototype.write = function write(string, offset, length, encoding) {
        if (offset === void 0) {
          encoding = "utf8";
          length = this.length;
          offset = 0;
        } else if (length === void 0 && typeof offset === "string") {
          encoding = offset;
          length = this.length;
          offset = 0;
        } else if (isFinite(offset)) {
          offset = offset >>> 0;
          if (isFinite(length)) {
            length = length >>> 0;
            if (encoding === void 0)
              encoding = "utf8";
          } else {
            encoding = length;
            length = void 0;
          }
        } else {
          throw new Error(
            "Buffer.write(string, encoding, offset[, length]) is no longer supported"
          );
        }
        var remaining = this.length - offset;
        if (length === void 0 || length > remaining)
          length = remaining;
        if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
          throw new RangeError("Attempt to write outside buffer bounds");
        }
        if (!encoding)
          encoding = "utf8";
        var loweredCase = false;
        for (; ; ) {
          switch (encoding) {
            case "hex":
              return hexWrite(this, string, offset, length);
            case "utf8":
            case "utf-8":
              return utf8Write(this, string, offset, length);
            case "ascii":
            case "latin1":
            case "binary":
              return asciiWrite(this, string, offset, length);
            case "base64":
              return base64Write(this, string, offset, length);
            case "ucs2":
            case "ucs-2":
            case "utf16le":
            case "utf-16le":
              return ucs2Write(this, string, offset, length);
            default:
              if (loweredCase)
                throw new TypeError("Unknown encoding: " + encoding);
              encoding = ("" + encoding).toLowerCase();
              loweredCase = true;
          }
        }
      };
      Buffer3.prototype.toJSON = function toJSON() {
        return {
          type: "Buffer",
          data: Array.prototype.slice.call(this._arr || this, 0)
        };
      };
      function base64Slice(buf, start, end) {
        if (start === 0 && end === buf.length) {
          return base64.fromByteArray(buf);
        } else {
          return base64.fromByteArray(buf.slice(start, end));
        }
      }
      function utf8Slice(buf, start, end) {
        end = Math.min(buf.length, end);
        var res = [];
        var i = start;
        while (i < end) {
          var firstByte = buf[i];
          var codePoint = null;
          var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
          if (i + bytesPerSequence <= end) {
            var secondByte, thirdByte, fourthByte, tempCodePoint;
            switch (bytesPerSequence) {
              case 1:
                if (firstByte < 128) {
                  codePoint = firstByte;
                }
                break;
              case 2:
                secondByte = buf[i + 1];
                if ((secondByte & 192) === 128) {
                  tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                  if (tempCodePoint > 127) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 3:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                  if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                    codePoint = tempCodePoint;
                  }
                }
                break;
              case 4:
                secondByte = buf[i + 1];
                thirdByte = buf[i + 2];
                fourthByte = buf[i + 3];
                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                  tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                  if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                    codePoint = tempCodePoint;
                  }
                }
            }
          }
          if (codePoint === null) {
            codePoint = 65533;
            bytesPerSequence = 1;
          } else if (codePoint > 65535) {
            codePoint -= 65536;
            res.push(codePoint >>> 10 & 1023 | 55296);
            codePoint = 56320 | codePoint & 1023;
          }
          res.push(codePoint);
          i += bytesPerSequence;
        }
        return decodeCodePointsArray(res);
      }
      var MAX_ARGUMENTS_LENGTH = 4096;
      function decodeCodePointsArray(codePoints) {
        var len = codePoints.length;
        if (len <= MAX_ARGUMENTS_LENGTH) {
          return String.fromCharCode.apply(String, codePoints);
        }
        var res = "";
        var i = 0;
        while (i < len) {
          res += String.fromCharCode.apply(
            String,
            codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
          );
        }
        return res;
      }
      function asciiSlice(buf, start, end) {
        var ret = "";
        end = Math.min(buf.length, end);
        for (var i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i] & 127);
        }
        return ret;
      }
      function latin1Slice(buf, start, end) {
        var ret = "";
        end = Math.min(buf.length, end);
        for (var i = start; i < end; ++i) {
          ret += String.fromCharCode(buf[i]);
        }
        return ret;
      }
      function hexSlice(buf, start, end) {
        var len = buf.length;
        if (!start || start < 0)
          start = 0;
        if (!end || end < 0 || end > len)
          end = len;
        var out = "";
        for (var i = start; i < end; ++i) {
          out += hexSliceLookupTable[buf[i]];
        }
        return out;
      }
      function utf16leSlice(buf, start, end) {
        var bytes = buf.slice(start, end);
        var res = "";
        for (var i = 0; i < bytes.length - 1; i += 2) {
          res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
        }
        return res;
      }
      Buffer3.prototype.slice = function slice(start, end) {
        var len = this.length;
        start = ~~start;
        end = end === void 0 ? len : ~~end;
        if (start < 0) {
          start += len;
          if (start < 0)
            start = 0;
        } else if (start > len) {
          start = len;
        }
        if (end < 0) {
          end += len;
          if (end < 0)
            end = 0;
        } else if (end > len) {
          end = len;
        }
        if (end < start)
          end = start;
        var newBuf = this.subarray(start, end);
        Object.setPrototypeOf(newBuf, Buffer3.prototype);
        return newBuf;
      };
      function checkOffset(offset, ext, length) {
        if (offset % 1 !== 0 || offset < 0)
          throw new RangeError("offset is not uint");
        if (offset + ext > length)
          throw new RangeError("Trying to access beyond buffer length");
      }
      Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE2(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        var val = this[offset];
        var mul = 1;
        var i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          checkOffset(offset, byteLength2, this.length);
        }
        var val = this[offset + --byteLength2];
        var mul = 1;
        while (byteLength2 > 0 && (mul *= 256)) {
          val += this[offset + --byteLength2] * mul;
        }
        return val;
      };
      Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 1, this.length);
        return this[offset];
      };
      Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        return this[offset] | this[offset + 1] << 8;
      };
      Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        return this[offset] << 8 | this[offset + 1];
      };
      Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
      };
      Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
      };
      Buffer3.prototype.readIntLE = function readIntLE2(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        var val = this[offset];
        var mul = 1;
        var i = 0;
        while (++i < byteLength2 && (mul *= 256)) {
          val += this[offset + i] * mul;
        }
        mul *= 128;
        if (val >= mul)
          val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert)
          checkOffset(offset, byteLength2, this.length);
        var i = byteLength2;
        var mul = 1;
        var val = this[offset + --i];
        while (i > 0 && (mul *= 256)) {
          val += this[offset + --i] * mul;
        }
        mul *= 128;
        if (val >= mul)
          val -= Math.pow(2, 8 * byteLength2);
        return val;
      };
      Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 1, this.length);
        if (!(this[offset] & 128))
          return this[offset];
        return (255 - this[offset] + 1) * -1;
      };
      Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        var val = this[offset] | this[offset + 1] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 2, this.length);
        var val = this[offset + 1] | this[offset] << 8;
        return val & 32768 ? val | 4294901760 : val;
      };
      Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
      };
      Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
      };
      Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, true, 23, 4);
      };
      Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 4, this.length);
        return ieee754.read(this, offset, false, 23, 4);
      };
      Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, true, 52, 8);
      };
      Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
        offset = offset >>> 0;
        if (!noAssert)
          checkOffset(offset, 8, this.length);
        return ieee754.read(this, offset, false, 52, 8);
      };
      function checkInt(buf, value4, offset, ext, max, min) {
        if (!Buffer3.isBuffer(buf))
          throw new TypeError('"buffer" argument must be a Buffer instance');
        if (value4 > max || value4 < min)
          throw new RangeError('"value" argument is out of bounds');
        if (offset + ext > buf.length)
          throw new RangeError("Index out of range");
      }
      Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE2(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value4, offset, byteLength2, maxBytes, 0);
        }
        var mul = 1;
        var i = 0;
        this[offset] = value4 & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          this[offset + i] = value4 / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        byteLength2 = byteLength2 >>> 0;
        if (!noAssert) {
          var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
          checkInt(this, value4, offset, byteLength2, maxBytes, 0);
        }
        var i = byteLength2 - 1;
        var mul = 1;
        this[offset + i] = value4 & 255;
        while (--i >= 0 && (mul *= 256)) {
          this[offset + i] = value4 / mul & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 1, 255, 0);
        this[offset] = value4 & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 65535, 0);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 65535, 0);
        this[offset] = value4 >>> 8;
        this[offset + 1] = value4 & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 4294967295, 0);
        this[offset + 3] = value4 >>> 24;
        this[offset + 2] = value4 >>> 16;
        this[offset + 1] = value4 >>> 8;
        this[offset] = value4 & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 4294967295, 0);
        this[offset] = value4 >>> 24;
        this[offset + 1] = value4 >>> 16;
        this[offset + 2] = value4 >>> 8;
        this[offset + 3] = value4 & 255;
        return offset + 4;
      };
      Buffer3.prototype.writeIntLE = function writeIntLE2(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          var limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value4, offset, byteLength2, limit - 1, -limit);
        }
        var i = 0;
        var mul = 1;
        var sub = 0;
        this[offset] = value4 & 255;
        while (++i < byteLength2 && (mul *= 256)) {
          if (value4 < 0 && sub === 0 && this[offset + i - 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value4 / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeIntBE = function writeIntBE(value4, offset, byteLength2, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          var limit = Math.pow(2, 8 * byteLength2 - 1);
          checkInt(this, value4, offset, byteLength2, limit - 1, -limit);
        }
        var i = byteLength2 - 1;
        var mul = 1;
        var sub = 0;
        this[offset + i] = value4 & 255;
        while (--i >= 0 && (mul *= 256)) {
          if (value4 < 0 && sub === 0 && this[offset + i + 1] !== 0) {
            sub = 1;
          }
          this[offset + i] = (value4 / mul >> 0) - sub & 255;
        }
        return offset + byteLength2;
      };
      Buffer3.prototype.writeInt8 = function writeInt8(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 1, 127, -128);
        if (value4 < 0)
          value4 = 255 + value4 + 1;
        this[offset] = value4 & 255;
        return offset + 1;
      };
      Buffer3.prototype.writeInt16LE = function writeInt16LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 32767, -32768);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        return offset + 2;
      };
      Buffer3.prototype.writeInt16BE = function writeInt16BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 2, 32767, -32768);
        this[offset] = value4 >>> 8;
        this[offset + 1] = value4 & 255;
        return offset + 2;
      };
      Buffer3.prototype.writeInt32LE = function writeInt32LE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 2147483647, -2147483648);
        this[offset] = value4 & 255;
        this[offset + 1] = value4 >>> 8;
        this[offset + 2] = value4 >>> 16;
        this[offset + 3] = value4 >>> 24;
        return offset + 4;
      };
      Buffer3.prototype.writeInt32BE = function writeInt32BE(value4, offset, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert)
          checkInt(this, value4, offset, 4, 2147483647, -2147483648);
        if (value4 < 0)
          value4 = 4294967295 + value4 + 1;
        this[offset] = value4 >>> 24;
        this[offset + 1] = value4 >>> 16;
        this[offset + 2] = value4 >>> 8;
        this[offset + 3] = value4 & 255;
        return offset + 4;
      };
      function checkIEEE754(buf, value4, offset, ext, max, min) {
        if (offset + ext > buf.length)
          throw new RangeError("Index out of range");
        if (offset < 0)
          throw new RangeError("Index out of range");
      }
      function writeFloat(buf, value4, offset, littleEndian, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value4, offset, 4, 34028234663852886e22, -34028234663852886e22);
        }
        ieee754.write(buf, value4, offset, littleEndian, 23, 4);
        return offset + 4;
      }
      Buffer3.prototype.writeFloatLE = function writeFloatLE(value4, offset, noAssert) {
        return writeFloat(this, value4, offset, true, noAssert);
      };
      Buffer3.prototype.writeFloatBE = function writeFloatBE(value4, offset, noAssert) {
        return writeFloat(this, value4, offset, false, noAssert);
      };
      function writeDouble(buf, value4, offset, littleEndian, noAssert) {
        value4 = +value4;
        offset = offset >>> 0;
        if (!noAssert) {
          checkIEEE754(buf, value4, offset, 8, 17976931348623157e292, -17976931348623157e292);
        }
        ieee754.write(buf, value4, offset, littleEndian, 52, 8);
        return offset + 8;
      }
      Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value4, offset, noAssert) {
        return writeDouble(this, value4, offset, true, noAssert);
      };
      Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value4, offset, noAssert) {
        return writeDouble(this, value4, offset, false, noAssert);
      };
      Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
        if (!Buffer3.isBuffer(target))
          throw new TypeError("argument should be a Buffer");
        if (!start)
          start = 0;
        if (!end && end !== 0)
          end = this.length;
        if (targetStart >= target.length)
          targetStart = target.length;
        if (!targetStart)
          targetStart = 0;
        if (end > 0 && end < start)
          end = start;
        if (end === start)
          return 0;
        if (target.length === 0 || this.length === 0)
          return 0;
        if (targetStart < 0) {
          throw new RangeError("targetStart out of bounds");
        }
        if (start < 0 || start >= this.length)
          throw new RangeError("Index out of range");
        if (end < 0)
          throw new RangeError("sourceEnd out of bounds");
        if (end > this.length)
          end = this.length;
        if (target.length - targetStart < end - start) {
          end = target.length - targetStart + start;
        }
        var len = end - start;
        if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
          this.copyWithin(targetStart, start, end);
        } else {
          Uint8Array.prototype.set.call(
            target,
            this.subarray(start, end),
            targetStart
          );
        }
        return len;
      };
      Buffer3.prototype.fill = function fill(val, start, end, encoding) {
        if (typeof val === "string") {
          if (typeof start === "string") {
            encoding = start;
            start = 0;
            end = this.length;
          } else if (typeof end === "string") {
            encoding = end;
            end = this.length;
          }
          if (encoding !== void 0 && typeof encoding !== "string") {
            throw new TypeError("encoding must be a string");
          }
          if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
            throw new TypeError("Unknown encoding: " + encoding);
          }
          if (val.length === 1) {
            var code = val.charCodeAt(0);
            if (encoding === "utf8" && code < 128 || encoding === "latin1") {
              val = code;
            }
          }
        } else if (typeof val === "number") {
          val = val & 255;
        } else if (typeof val === "boolean") {
          val = Number(val);
        }
        if (start < 0 || this.length < start || this.length < end) {
          throw new RangeError("Out of range index");
        }
        if (end <= start) {
          return this;
        }
        start = start >>> 0;
        end = end === void 0 ? this.length : end >>> 0;
        if (!val)
          val = 0;
        var i;
        if (typeof val === "number") {
          for (i = start; i < end; ++i) {
            this[i] = val;
          }
        } else {
          var bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
          var len = bytes.length;
          if (len === 0) {
            throw new TypeError('The value "' + val + '" is invalid for argument "value"');
          }
          for (i = 0; i < end - start; ++i) {
            this[i + start] = bytes[i % len];
          }
        }
        return this;
      };
      var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
      function base64clean(str) {
        str = str.split("=")[0];
        str = str.trim().replace(INVALID_BASE64_RE, "");
        if (str.length < 2)
          return "";
        while (str.length % 4 !== 0) {
          str = str + "=";
        }
        return str;
      }
      function utf8ToBytes3(string, units) {
        units = units || Infinity;
        var codePoint;
        var length = string.length;
        var leadSurrogate = null;
        var bytes = [];
        for (var i = 0; i < length; ++i) {
          codePoint = string.charCodeAt(i);
          if (codePoint > 55295 && codePoint < 57344) {
            if (!leadSurrogate) {
              if (codePoint > 56319) {
                if ((units -= 3) > -1)
                  bytes.push(239, 191, 189);
                continue;
              } else if (i + 1 === length) {
                if ((units -= 3) > -1)
                  bytes.push(239, 191, 189);
                continue;
              }
              leadSurrogate = codePoint;
              continue;
            }
            if (codePoint < 56320) {
              if ((units -= 3) > -1)
                bytes.push(239, 191, 189);
              leadSurrogate = codePoint;
              continue;
            }
            codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
          } else if (leadSurrogate) {
            if ((units -= 3) > -1)
              bytes.push(239, 191, 189);
          }
          leadSurrogate = null;
          if (codePoint < 128) {
            if ((units -= 1) < 0)
              break;
            bytes.push(codePoint);
          } else if (codePoint < 2048) {
            if ((units -= 2) < 0)
              break;
            bytes.push(
              codePoint >> 6 | 192,
              codePoint & 63 | 128
            );
          } else if (codePoint < 65536) {
            if ((units -= 3) < 0)
              break;
            bytes.push(
              codePoint >> 12 | 224,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else if (codePoint < 1114112) {
            if ((units -= 4) < 0)
              break;
            bytes.push(
              codePoint >> 18 | 240,
              codePoint >> 12 & 63 | 128,
              codePoint >> 6 & 63 | 128,
              codePoint & 63 | 128
            );
          } else {
            throw new Error("Invalid code point");
          }
        }
        return bytes;
      }
      function asciiToBytes(str) {
        var byteArray = [];
        for (var i = 0; i < str.length; ++i) {
          byteArray.push(str.charCodeAt(i) & 255);
        }
        return byteArray;
      }
      function utf16leToBytes(str, units) {
        var c3, hi, lo;
        var byteArray = [];
        for (var i = 0; i < str.length; ++i) {
          if ((units -= 2) < 0)
            break;
          c3 = str.charCodeAt(i);
          hi = c3 >> 8;
          lo = c3 % 256;
          byteArray.push(lo);
          byteArray.push(hi);
        }
        return byteArray;
      }
      function base64ToBytes(str) {
        return base64.toByteArray(base64clean(str));
      }
      function blitBuffer(src, dst, offset, length) {
        for (var i = 0; i < length; ++i) {
          if (i + offset >= dst.length || i >= src.length)
            break;
          dst[i + offset] = src[i];
        }
        return i;
      }
      function isInstance(obj, type) {
        return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
      }
      function numberIsNaN(obj) {
        return obj !== obj;
      }
      var hexSliceLookupTable = function() {
        var alphabet2 = "0123456789abcdef";
        var table = new Array(256);
        for (var i = 0; i < 16; ++i) {
          var i16 = i * 16;
          for (var j2 = 0; j2 < 16; ++j2) {
            table[i16 + j2] = alphabet2[i] + alphabet2[j2];
          }
        }
        return table;
      }();
    }
  });

  // node_modules/bignumber.js/bignumber.js
  var require_bignumber = __commonJS({
    "node_modules/bignumber.js/bignumber.js"(exports, module) {
      (function(globalObject) {
        "use strict";
        var BigNumber, isNumeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i, mathceil = Math.ceil, mathfloor = Math.floor, bignumberError = "[BigNumber Error] ", tooManyDigits = bignumberError + "Number primitive has more than 15 significant digits: ", BASE = 1e14, LOG_BASE = 14, MAX_SAFE_INTEGER = 9007199254740991, POWS_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13], SQRT_BASE = 1e7, MAX = 1e9;
        function clone(configObject) {
          var div, convertBase, parseNumeric, P2 = BigNumber2.prototype = { constructor: BigNumber2, toString: null, valueOf: null }, ONE = new BigNumber2(1), DECIMAL_PLACES = 20, ROUNDING_MODE = 4, TO_EXP_NEG = -7, TO_EXP_POS = 21, MIN_EXP = -1e7, MAX_EXP = 1e7, CRYPTO = false, MODULO_MODE = 1, POW_PRECISION = 0, FORMAT = {
            prefix: "",
            groupSize: 3,
            secondaryGroupSize: 0,
            groupSeparator: ",",
            decimalSeparator: ".",
            fractionGroupSize: 0,
            fractionGroupSeparator: "\xA0",
            // non-breaking space
            suffix: ""
          }, ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz", alphabetHasNormalDecimalDigits = true;
          function BigNumber2(v2, b3) {
            var alphabet2, c3, caseChanged, e3, i, isNum, len, str, x5 = this;
            if (!(x5 instanceof BigNumber2))
              return new BigNumber2(v2, b3);
            if (b3 == null) {
              if (v2 && v2._isBigNumber === true) {
                x5.s = v2.s;
                if (!v2.c || v2.e > MAX_EXP) {
                  x5.c = x5.e = null;
                } else if (v2.e < MIN_EXP) {
                  x5.c = [x5.e = 0];
                } else {
                  x5.e = v2.e;
                  x5.c = v2.c.slice();
                }
                return;
              }
              if ((isNum = typeof v2 == "number") && v2 * 0 == 0) {
                x5.s = 1 / v2 < 0 ? (v2 = -v2, -1) : 1;
                if (v2 === ~~v2) {
                  for (e3 = 0, i = v2; i >= 10; i /= 10, e3++)
                    ;
                  if (e3 > MAX_EXP) {
                    x5.c = x5.e = null;
                  } else {
                    x5.e = e3;
                    x5.c = [v2];
                  }
                  return;
                }
                str = String(v2);
              } else {
                if (!isNumeric.test(str = String(v2)))
                  return parseNumeric(x5, str, isNum);
                x5.s = str.charCodeAt(0) == 45 ? (str = str.slice(1), -1) : 1;
              }
              if ((e3 = str.indexOf(".")) > -1)
                str = str.replace(".", "");
              if ((i = str.search(/e/i)) > 0) {
                if (e3 < 0)
                  e3 = i;
                e3 += +str.slice(i + 1);
                str = str.substring(0, i);
              } else if (e3 < 0) {
                e3 = str.length;
              }
            } else {
              intCheck(b3, 2, ALPHABET.length, "Base");
              if (b3 == 10 && alphabetHasNormalDecimalDigits) {
                x5 = new BigNumber2(v2);
                return round(x5, DECIMAL_PLACES + x5.e + 1, ROUNDING_MODE);
              }
              str = String(v2);
              if (isNum = typeof v2 == "number") {
                if (v2 * 0 != 0)
                  return parseNumeric(x5, str, isNum, b3);
                x5.s = 1 / v2 < 0 ? (str = str.slice(1), -1) : 1;
                if (BigNumber2.DEBUG && str.replace(/^0\.0*|\./, "").length > 15) {
                  throw Error(tooManyDigits + v2);
                }
              } else {
                x5.s = str.charCodeAt(0) === 45 ? (str = str.slice(1), -1) : 1;
              }
              alphabet2 = ALPHABET.slice(0, b3);
              e3 = i = 0;
              for (len = str.length; i < len; i++) {
                if (alphabet2.indexOf(c3 = str.charAt(i)) < 0) {
                  if (c3 == ".") {
                    if (i > e3) {
                      e3 = len;
                      continue;
                    }
                  } else if (!caseChanged) {
                    if (str == str.toUpperCase() && (str = str.toLowerCase()) || str == str.toLowerCase() && (str = str.toUpperCase())) {
                      caseChanged = true;
                      i = -1;
                      e3 = 0;
                      continue;
                    }
                  }
                  return parseNumeric(x5, String(v2), isNum, b3);
                }
              }
              isNum = false;
              str = convertBase(str, b3, 10, x5.s);
              if ((e3 = str.indexOf(".")) > -1)
                str = str.replace(".", "");
              else
                e3 = str.length;
            }
            for (i = 0; str.charCodeAt(i) === 48; i++)
              ;
            for (len = str.length; str.charCodeAt(--len) === 48; )
              ;
            if (str = str.slice(i, ++len)) {
              len -= i;
              if (isNum && BigNumber2.DEBUG && len > 15 && (v2 > MAX_SAFE_INTEGER || v2 !== mathfloor(v2))) {
                throw Error(tooManyDigits + x5.s * v2);
              }
              if ((e3 = e3 - i - 1) > MAX_EXP) {
                x5.c = x5.e = null;
              } else if (e3 < MIN_EXP) {
                x5.c = [x5.e = 0];
              } else {
                x5.e = e3;
                x5.c = [];
                i = (e3 + 1) % LOG_BASE;
                if (e3 < 0)
                  i += LOG_BASE;
                if (i < len) {
                  if (i)
                    x5.c.push(+str.slice(0, i));
                  for (len -= LOG_BASE; i < len; ) {
                    x5.c.push(+str.slice(i, i += LOG_BASE));
                  }
                  i = LOG_BASE - (str = str.slice(i)).length;
                } else {
                  i -= len;
                }
                for (; i--; str += "0")
                  ;
                x5.c.push(+str);
              }
            } else {
              x5.c = [x5.e = 0];
            }
          }
          BigNumber2.clone = clone;
          BigNumber2.ROUND_UP = 0;
          BigNumber2.ROUND_DOWN = 1;
          BigNumber2.ROUND_CEIL = 2;
          BigNumber2.ROUND_FLOOR = 3;
          BigNumber2.ROUND_HALF_UP = 4;
          BigNumber2.ROUND_HALF_DOWN = 5;
          BigNumber2.ROUND_HALF_EVEN = 6;
          BigNumber2.ROUND_HALF_CEIL = 7;
          BigNumber2.ROUND_HALF_FLOOR = 8;
          BigNumber2.EUCLID = 9;
          BigNumber2.config = BigNumber2.set = function(obj) {
            var p3, v2;
            if (obj != null) {
              if (typeof obj == "object") {
                if (obj.hasOwnProperty(p3 = "DECIMAL_PLACES")) {
                  v2 = obj[p3];
                  intCheck(v2, 0, MAX, p3);
                  DECIMAL_PLACES = v2;
                }
                if (obj.hasOwnProperty(p3 = "ROUNDING_MODE")) {
                  v2 = obj[p3];
                  intCheck(v2, 0, 8, p3);
                  ROUNDING_MODE = v2;
                }
                if (obj.hasOwnProperty(p3 = "EXPONENTIAL_AT")) {
                  v2 = obj[p3];
                  if (v2 && v2.pop) {
                    intCheck(v2[0], -MAX, 0, p3);
                    intCheck(v2[1], 0, MAX, p3);
                    TO_EXP_NEG = v2[0];
                    TO_EXP_POS = v2[1];
                  } else {
                    intCheck(v2, -MAX, MAX, p3);
                    TO_EXP_NEG = -(TO_EXP_POS = v2 < 0 ? -v2 : v2);
                  }
                }
                if (obj.hasOwnProperty(p3 = "RANGE")) {
                  v2 = obj[p3];
                  if (v2 && v2.pop) {
                    intCheck(v2[0], -MAX, -1, p3);
                    intCheck(v2[1], 1, MAX, p3);
                    MIN_EXP = v2[0];
                    MAX_EXP = v2[1];
                  } else {
                    intCheck(v2, -MAX, MAX, p3);
                    if (v2) {
                      MIN_EXP = -(MAX_EXP = v2 < 0 ? -v2 : v2);
                    } else {
                      throw Error(bignumberError + p3 + " cannot be zero: " + v2);
                    }
                  }
                }
                if (obj.hasOwnProperty(p3 = "CRYPTO")) {
                  v2 = obj[p3];
                  if (v2 === !!v2) {
                    if (v2) {
                      if (typeof crypto != "undefined" && crypto && (crypto.getRandomValues || crypto.randomBytes)) {
                        CRYPTO = v2;
                      } else {
                        CRYPTO = !v2;
                        throw Error(bignumberError + "crypto unavailable");
                      }
                    } else {
                      CRYPTO = v2;
                    }
                  } else {
                    throw Error(bignumberError + p3 + " not true or false: " + v2);
                  }
                }
                if (obj.hasOwnProperty(p3 = "MODULO_MODE")) {
                  v2 = obj[p3];
                  intCheck(v2, 0, 9, p3);
                  MODULO_MODE = v2;
                }
                if (obj.hasOwnProperty(p3 = "POW_PRECISION")) {
                  v2 = obj[p3];
                  intCheck(v2, 0, MAX, p3);
                  POW_PRECISION = v2;
                }
                if (obj.hasOwnProperty(p3 = "FORMAT")) {
                  v2 = obj[p3];
                  if (typeof v2 == "object")
                    FORMAT = v2;
                  else
                    throw Error(bignumberError + p3 + " not an object: " + v2);
                }
                if (obj.hasOwnProperty(p3 = "ALPHABET")) {
                  v2 = obj[p3];
                  if (typeof v2 == "string" && !/^.?$|[+\-.\s]|(.).*\1/.test(v2)) {
                    alphabetHasNormalDecimalDigits = v2.slice(0, 10) == "0123456789";
                    ALPHABET = v2;
                  } else {
                    throw Error(bignumberError + p3 + " invalid: " + v2);
                  }
                }
              } else {
                throw Error(bignumberError + "Object expected: " + obj);
              }
            }
            return {
              DECIMAL_PLACES,
              ROUNDING_MODE,
              EXPONENTIAL_AT: [TO_EXP_NEG, TO_EXP_POS],
              RANGE: [MIN_EXP, MAX_EXP],
              CRYPTO,
              MODULO_MODE,
              POW_PRECISION,
              FORMAT,
              ALPHABET
            };
          };
          BigNumber2.isBigNumber = function(v2) {
            if (!v2 || v2._isBigNumber !== true)
              return false;
            if (!BigNumber2.DEBUG)
              return true;
            var i, n2, c3 = v2.c, e3 = v2.e, s2 = v2.s;
            out:
              if ({}.toString.call(c3) == "[object Array]") {
                if ((s2 === 1 || s2 === -1) && e3 >= -MAX && e3 <= MAX && e3 === mathfloor(e3)) {
                  if (c3[0] === 0) {
                    if (e3 === 0 && c3.length === 1)
                      return true;
                    break out;
                  }
                  i = (e3 + 1) % LOG_BASE;
                  if (i < 1)
                    i += LOG_BASE;
                  if (String(c3[0]).length == i) {
                    for (i = 0; i < c3.length; i++) {
                      n2 = c3[i];
                      if (n2 < 0 || n2 >= BASE || n2 !== mathfloor(n2))
                        break out;
                    }
                    if (n2 !== 0)
                      return true;
                  }
                }
              } else if (c3 === null && e3 === null && (s2 === null || s2 === 1 || s2 === -1)) {
                return true;
              }
            throw Error(bignumberError + "Invalid BigNumber: " + v2);
          };
          BigNumber2.maximum = BigNumber2.max = function() {
            return maxOrMin(arguments, -1);
          };
          BigNumber2.minimum = BigNumber2.min = function() {
            return maxOrMin(arguments, 1);
          };
          BigNumber2.random = function() {
            var pow2_53 = 9007199254740992;
            var random53bitInt = Math.random() * pow2_53 & 2097151 ? function() {
              return mathfloor(Math.random() * pow2_53);
            } : function() {
              return (Math.random() * 1073741824 | 0) * 8388608 + (Math.random() * 8388608 | 0);
            };
            return function(dp) {
              var a, b3, e3, k2, v2, i = 0, c3 = [], rand = new BigNumber2(ONE);
              if (dp == null)
                dp = DECIMAL_PLACES;
              else
                intCheck(dp, 0, MAX);
              k2 = mathceil(dp / LOG_BASE);
              if (CRYPTO) {
                if (crypto.getRandomValues) {
                  a = crypto.getRandomValues(new Uint32Array(k2 *= 2));
                  for (; i < k2; ) {
                    v2 = a[i] * 131072 + (a[i + 1] >>> 11);
                    if (v2 >= 9e15) {
                      b3 = crypto.getRandomValues(new Uint32Array(2));
                      a[i] = b3[0];
                      a[i + 1] = b3[1];
                    } else {
                      c3.push(v2 % 1e14);
                      i += 2;
                    }
                  }
                  i = k2 / 2;
                } else if (crypto.randomBytes) {
                  a = crypto.randomBytes(k2 *= 7);
                  for (; i < k2; ) {
                    v2 = (a[i] & 31) * 281474976710656 + a[i + 1] * 1099511627776 + a[i + 2] * 4294967296 + a[i + 3] * 16777216 + (a[i + 4] << 16) + (a[i + 5] << 8) + a[i + 6];
                    if (v2 >= 9e15) {
                      crypto.randomBytes(7).copy(a, i);
                    } else {
                      c3.push(v2 % 1e14);
                      i += 7;
                    }
                  }
                  i = k2 / 7;
                } else {
                  CRYPTO = false;
                  throw Error(bignumberError + "crypto unavailable");
                }
              }
              if (!CRYPTO) {
                for (; i < k2; ) {
                  v2 = random53bitInt();
                  if (v2 < 9e15)
                    c3[i++] = v2 % 1e14;
                }
              }
              k2 = c3[--i];
              dp %= LOG_BASE;
              if (k2 && dp) {
                v2 = POWS_TEN[LOG_BASE - dp];
                c3[i] = mathfloor(k2 / v2) * v2;
              }
              for (; c3[i] === 0; c3.pop(), i--)
                ;
              if (i < 0) {
                c3 = [e3 = 0];
              } else {
                for (e3 = -1; c3[0] === 0; c3.splice(0, 1), e3 -= LOG_BASE)
                  ;
                for (i = 1, v2 = c3[0]; v2 >= 10; v2 /= 10, i++)
                  ;
                if (i < LOG_BASE)
                  e3 -= LOG_BASE - i;
              }
              rand.e = e3;
              rand.c = c3;
              return rand;
            };
          }();
          BigNumber2.sum = function() {
            var i = 1, args = arguments, sum = new BigNumber2(args[0]);
            for (; i < args.length; )
              sum = sum.plus(args[i++]);
            return sum;
          };
          convertBase = function() {
            var decimal = "0123456789";
            function toBaseOut(str, baseIn, baseOut, alphabet2) {
              var j2, arr = [0], arrL, i = 0, len = str.length;
              for (; i < len; ) {
                for (arrL = arr.length; arrL--; arr[arrL] *= baseIn)
                  ;
                arr[0] += alphabet2.indexOf(str.charAt(i++));
                for (j2 = 0; j2 < arr.length; j2++) {
                  if (arr[j2] > baseOut - 1) {
                    if (arr[j2 + 1] == null)
                      arr[j2 + 1] = 0;
                    arr[j2 + 1] += arr[j2] / baseOut | 0;
                    arr[j2] %= baseOut;
                  }
                }
              }
              return arr.reverse();
            }
            return function(str, baseIn, baseOut, sign, callerIsToString) {
              var alphabet2, d2, e3, k2, r, x5, xc, y, i = str.indexOf("."), dp = DECIMAL_PLACES, rm = ROUNDING_MODE;
              if (i >= 0) {
                k2 = POW_PRECISION;
                POW_PRECISION = 0;
                str = str.replace(".", "");
                y = new BigNumber2(baseIn);
                x5 = y.pow(str.length - i);
                POW_PRECISION = k2;
                y.c = toBaseOut(
                  toFixedPoint(coeffToString(x5.c), x5.e, "0"),
                  10,
                  baseOut,
                  decimal
                );
                y.e = y.c.length;
              }
              xc = toBaseOut(str, baseIn, baseOut, callerIsToString ? (alphabet2 = ALPHABET, decimal) : (alphabet2 = decimal, ALPHABET));
              e3 = k2 = xc.length;
              for (; xc[--k2] == 0; xc.pop())
                ;
              if (!xc[0])
                return alphabet2.charAt(0);
              if (i < 0) {
                --e3;
              } else {
                x5.c = xc;
                x5.e = e3;
                x5.s = sign;
                x5 = div(x5, y, dp, rm, baseOut);
                xc = x5.c;
                r = x5.r;
                e3 = x5.e;
              }
              d2 = e3 + dp + 1;
              i = xc[d2];
              k2 = baseOut / 2;
              r = r || d2 < 0 || xc[d2 + 1] != null;
              r = rm < 4 ? (i != null || r) && (rm == 0 || rm == (x5.s < 0 ? 3 : 2)) : i > k2 || i == k2 && (rm == 4 || r || rm == 6 && xc[d2 - 1] & 1 || rm == (x5.s < 0 ? 8 : 7));
              if (d2 < 1 || !xc[0]) {
                str = r ? toFixedPoint(alphabet2.charAt(1), -dp, alphabet2.charAt(0)) : alphabet2.charAt(0);
              } else {
                xc.length = d2;
                if (r) {
                  for (--baseOut; ++xc[--d2] > baseOut; ) {
                    xc[d2] = 0;
                    if (!d2) {
                      ++e3;
                      xc = [1].concat(xc);
                    }
                  }
                }
                for (k2 = xc.length; !xc[--k2]; )
                  ;
                for (i = 0, str = ""; i <= k2; str += alphabet2.charAt(xc[i++]))
                  ;
                str = toFixedPoint(str, e3, alphabet2.charAt(0));
              }
              return str;
            };
          }();
          div = function() {
            function multiply(x5, k2, base) {
              var m3, temp, xlo, xhi, carry = 0, i = x5.length, klo = k2 % SQRT_BASE, khi = k2 / SQRT_BASE | 0;
              for (x5 = x5.slice(); i--; ) {
                xlo = x5[i] % SQRT_BASE;
                xhi = x5[i] / SQRT_BASE | 0;
                m3 = khi * xlo + xhi * klo;
                temp = klo * xlo + m3 % SQRT_BASE * SQRT_BASE + carry;
                carry = (temp / base | 0) + (m3 / SQRT_BASE | 0) + khi * xhi;
                x5[i] = temp % base;
              }
              if (carry)
                x5 = [carry].concat(x5);
              return x5;
            }
            function compare3(a, b3, aL, bL) {
              var i, cmp;
              if (aL != bL) {
                cmp = aL > bL ? 1 : -1;
              } else {
                for (i = cmp = 0; i < aL; i++) {
                  if (a[i] != b3[i]) {
                    cmp = a[i] > b3[i] ? 1 : -1;
                    break;
                  }
                }
              }
              return cmp;
            }
            function subtract(a, b3, aL, base) {
              var i = 0;
              for (; aL--; ) {
                a[aL] -= i;
                i = a[aL] < b3[aL] ? 1 : 0;
                a[aL] = i * base + a[aL] - b3[aL];
              }
              for (; !a[0] && a.length > 1; a.splice(0, 1))
                ;
            }
            return function(x5, y, dp, rm, base) {
              var cmp, e3, i, more, n2, prod, prodL, q, qc, rem, remL, rem0, xi, xL, yc0, yL, yz, s2 = x5.s == y.s ? 1 : -1, xc = x5.c, yc = y.c;
              if (!xc || !xc[0] || !yc || !yc[0]) {
                return new BigNumber2(
                  // Return NaN if either NaN, or both Infinity or 0.
                  !x5.s || !y.s || (xc ? yc && xc[0] == yc[0] : !yc) ? NaN : (
                    // Return ±0 if x is ±0 or y is ±Infinity, or return ±Infinity as y is ±0.
                    xc && xc[0] == 0 || !yc ? s2 * 0 : s2 / 0
                  )
                );
              }
              q = new BigNumber2(s2);
              qc = q.c = [];
              e3 = x5.e - y.e;
              s2 = dp + e3 + 1;
              if (!base) {
                base = BASE;
                e3 = bitFloor(x5.e / LOG_BASE) - bitFloor(y.e / LOG_BASE);
                s2 = s2 / LOG_BASE | 0;
              }
              for (i = 0; yc[i] == (xc[i] || 0); i++)
                ;
              if (yc[i] > (xc[i] || 0))
                e3--;
              if (s2 < 0) {
                qc.push(1);
                more = true;
              } else {
                xL = xc.length;
                yL = yc.length;
                i = 0;
                s2 += 2;
                n2 = mathfloor(base / (yc[0] + 1));
                if (n2 > 1) {
                  yc = multiply(yc, n2, base);
                  xc = multiply(xc, n2, base);
                  yL = yc.length;
                  xL = xc.length;
                }
                xi = yL;
                rem = xc.slice(0, yL);
                remL = rem.length;
                for (; remL < yL; rem[remL++] = 0)
                  ;
                yz = yc.slice();
                yz = [0].concat(yz);
                yc0 = yc[0];
                if (yc[1] >= base / 2)
                  yc0++;
                do {
                  n2 = 0;
                  cmp = compare3(yc, rem, yL, remL);
                  if (cmp < 0) {
                    rem0 = rem[0];
                    if (yL != remL)
                      rem0 = rem0 * base + (rem[1] || 0);
                    n2 = mathfloor(rem0 / yc0);
                    if (n2 > 1) {
                      if (n2 >= base)
                        n2 = base - 1;
                      prod = multiply(yc, n2, base);
                      prodL = prod.length;
                      remL = rem.length;
                      while (compare3(prod, rem, prodL, remL) == 1) {
                        n2--;
                        subtract(prod, yL < prodL ? yz : yc, prodL, base);
                        prodL = prod.length;
                        cmp = 1;
                      }
                    } else {
                      if (n2 == 0) {
                        cmp = n2 = 1;
                      }
                      prod = yc.slice();
                      prodL = prod.length;
                    }
                    if (prodL < remL)
                      prod = [0].concat(prod);
                    subtract(rem, prod, remL, base);
                    remL = rem.length;
                    if (cmp == -1) {
                      while (compare3(yc, rem, yL, remL) < 1) {
                        n2++;
                        subtract(rem, yL < remL ? yz : yc, remL, base);
                        remL = rem.length;
                      }
                    }
                  } else if (cmp === 0) {
                    n2++;
                    rem = [0];
                  }
                  qc[i++] = n2;
                  if (rem[0]) {
                    rem[remL++] = xc[xi] || 0;
                  } else {
                    rem = [xc[xi]];
                    remL = 1;
                  }
                } while ((xi++ < xL || rem[0] != null) && s2--);
                more = rem[0] != null;
                if (!qc[0])
                  qc.splice(0, 1);
              }
              if (base == BASE) {
                for (i = 1, s2 = qc[0]; s2 >= 10; s2 /= 10, i++)
                  ;
                round(q, dp + (q.e = i + e3 * LOG_BASE - 1) + 1, rm, more);
              } else {
                q.e = e3;
                q.r = +more;
              }
              return q;
            };
          }();
          function format(n2, i, rm, id) {
            var c0, e3, ne2, len, str;
            if (rm == null)
              rm = ROUNDING_MODE;
            else
              intCheck(rm, 0, 8);
            if (!n2.c)
              return n2.toString();
            c0 = n2.c[0];
            ne2 = n2.e;
            if (i == null) {
              str = coeffToString(n2.c);
              str = id == 1 || id == 2 && (ne2 <= TO_EXP_NEG || ne2 >= TO_EXP_POS) ? toExponential(str, ne2) : toFixedPoint(str, ne2, "0");
            } else {
              n2 = round(new BigNumber2(n2), i, rm);
              e3 = n2.e;
              str = coeffToString(n2.c);
              len = str.length;
              if (id == 1 || id == 2 && (i <= e3 || e3 <= TO_EXP_NEG)) {
                for (; len < i; str += "0", len++)
                  ;
                str = toExponential(str, e3);
              } else {
                i -= ne2;
                str = toFixedPoint(str, e3, "0");
                if (e3 + 1 > len) {
                  if (--i > 0)
                    for (str += "."; i--; str += "0")
                      ;
                } else {
                  i += e3 - len;
                  if (i > 0) {
                    if (e3 + 1 == len)
                      str += ".";
                    for (; i--; str += "0")
                      ;
                  }
                }
              }
            }
            return n2.s < 0 && c0 ? "-" + str : str;
          }
          function maxOrMin(args, n2) {
            var k2, y, i = 1, x5 = new BigNumber2(args[0]);
            for (; i < args.length; i++) {
              y = new BigNumber2(args[i]);
              if (!y.s || (k2 = compare2(x5, y)) === n2 || k2 === 0 && x5.s === n2) {
                x5 = y;
              }
            }
            return x5;
          }
          function normalise(n2, c3, e3) {
            var i = 1, j2 = c3.length;
            for (; !c3[--j2]; c3.pop())
              ;
            for (j2 = c3[0]; j2 >= 10; j2 /= 10, i++)
              ;
            if ((e3 = i + e3 * LOG_BASE - 1) > MAX_EXP) {
              n2.c = n2.e = null;
            } else if (e3 < MIN_EXP) {
              n2.c = [n2.e = 0];
            } else {
              n2.e = e3;
              n2.c = c3;
            }
            return n2;
          }
          parseNumeric = function() {
            var basePrefix = /^(-?)0([xbo])(?=\w[\w.]*$)/i, dotAfter = /^([^.]+)\.$/, dotBefore = /^\.([^.]+)$/, isInfinityOrNaN = /^-?(Infinity|NaN)$/, whitespaceOrPlus = /^\s*\+(?=[\w.])|^\s+|\s+$/g;
            return function(x5, str, isNum, b3) {
              var base, s2 = isNum ? str : str.replace(whitespaceOrPlus, "");
              if (isInfinityOrNaN.test(s2)) {
                x5.s = isNaN(s2) ? null : s2 < 0 ? -1 : 1;
              } else {
                if (!isNum) {
                  s2 = s2.replace(basePrefix, function(m3, p1, p22) {
                    base = (p22 = p22.toLowerCase()) == "x" ? 16 : p22 == "b" ? 2 : 8;
                    return !b3 || b3 == base ? p1 : m3;
                  });
                  if (b3) {
                    base = b3;
                    s2 = s2.replace(dotAfter, "$1").replace(dotBefore, "0.$1");
                  }
                  if (str != s2)
                    return new BigNumber2(s2, base);
                }
                if (BigNumber2.DEBUG) {
                  throw Error(bignumberError + "Not a" + (b3 ? " base " + b3 : "") + " number: " + str);
                }
                x5.s = null;
              }
              x5.c = x5.e = null;
            };
          }();
          function round(x5, sd, rm, r) {
            var d2, i, j2, k2, n2, ni, rd, xc = x5.c, pows10 = POWS_TEN;
            if (xc) {
              out: {
                for (d2 = 1, k2 = xc[0]; k2 >= 10; k2 /= 10, d2++)
                  ;
                i = sd - d2;
                if (i < 0) {
                  i += LOG_BASE;
                  j2 = sd;
                  n2 = xc[ni = 0];
                  rd = mathfloor(n2 / pows10[d2 - j2 - 1] % 10);
                } else {
                  ni = mathceil((i + 1) / LOG_BASE);
                  if (ni >= xc.length) {
                    if (r) {
                      for (; xc.length <= ni; xc.push(0))
                        ;
                      n2 = rd = 0;
                      d2 = 1;
                      i %= LOG_BASE;
                      j2 = i - LOG_BASE + 1;
                    } else {
                      break out;
                    }
                  } else {
                    n2 = k2 = xc[ni];
                    for (d2 = 1; k2 >= 10; k2 /= 10, d2++)
                      ;
                    i %= LOG_BASE;
                    j2 = i - LOG_BASE + d2;
                    rd = j2 < 0 ? 0 : mathfloor(n2 / pows10[d2 - j2 - 1] % 10);
                  }
                }
                r = r || sd < 0 || // Are there any non-zero digits after the rounding digit?
                // The expression  n % pows10[d - j - 1]  returns all digits of n to the right
                // of the digit at j, e.g. if n is 908714 and j is 2, the expression gives 714.
                xc[ni + 1] != null || (j2 < 0 ? n2 : n2 % pows10[d2 - j2 - 1]);
                r = rm < 4 ? (rd || r) && (rm == 0 || rm == (x5.s < 0 ? 3 : 2)) : rd > 5 || rd == 5 && (rm == 4 || r || rm == 6 && // Check whether the digit to the left of the rounding digit is odd.
                (i > 0 ? j2 > 0 ? n2 / pows10[d2 - j2] : 0 : xc[ni - 1]) % 10 & 1 || rm == (x5.s < 0 ? 8 : 7));
                if (sd < 1 || !xc[0]) {
                  xc.length = 0;
                  if (r) {
                    sd -= x5.e + 1;
                    xc[0] = pows10[(LOG_BASE - sd % LOG_BASE) % LOG_BASE];
                    x5.e = -sd || 0;
                  } else {
                    xc[0] = x5.e = 0;
                  }
                  return x5;
                }
                if (i == 0) {
                  xc.length = ni;
                  k2 = 1;
                  ni--;
                } else {
                  xc.length = ni + 1;
                  k2 = pows10[LOG_BASE - i];
                  xc[ni] = j2 > 0 ? mathfloor(n2 / pows10[d2 - j2] % pows10[j2]) * k2 : 0;
                }
                if (r) {
                  for (; ; ) {
                    if (ni == 0) {
                      for (i = 1, j2 = xc[0]; j2 >= 10; j2 /= 10, i++)
                        ;
                      j2 = xc[0] += k2;
                      for (k2 = 1; j2 >= 10; j2 /= 10, k2++)
                        ;
                      if (i != k2) {
                        x5.e++;
                        if (xc[0] == BASE)
                          xc[0] = 1;
                      }
                      break;
                    } else {
                      xc[ni] += k2;
                      if (xc[ni] != BASE)
                        break;
                      xc[ni--] = 0;
                      k2 = 1;
                    }
                  }
                }
                for (i = xc.length; xc[--i] === 0; xc.pop())
                  ;
              }
              if (x5.e > MAX_EXP) {
                x5.c = x5.e = null;
              } else if (x5.e < MIN_EXP) {
                x5.c = [x5.e = 0];
              }
            }
            return x5;
          }
          function valueOf(n2) {
            var str, e3 = n2.e;
            if (e3 === null)
              return n2.toString();
            str = coeffToString(n2.c);
            str = e3 <= TO_EXP_NEG || e3 >= TO_EXP_POS ? toExponential(str, e3) : toFixedPoint(str, e3, "0");
            return n2.s < 0 ? "-" + str : str;
          }
          P2.absoluteValue = P2.abs = function() {
            var x5 = new BigNumber2(this);
            if (x5.s < 0)
              x5.s = 1;
            return x5;
          };
          P2.comparedTo = function(y, b3) {
            return compare2(this, new BigNumber2(y, b3));
          };
          P2.decimalPlaces = P2.dp = function(dp, rm) {
            var c3, n2, v2, x5 = this;
            if (dp != null) {
              intCheck(dp, 0, MAX);
              if (rm == null)
                rm = ROUNDING_MODE;
              else
                intCheck(rm, 0, 8);
              return round(new BigNumber2(x5), dp + x5.e + 1, rm);
            }
            if (!(c3 = x5.c))
              return null;
            n2 = ((v2 = c3.length - 1) - bitFloor(this.e / LOG_BASE)) * LOG_BASE;
            if (v2 = c3[v2])
              for (; v2 % 10 == 0; v2 /= 10, n2--)
                ;
            if (n2 < 0)
              n2 = 0;
            return n2;
          };
          P2.dividedBy = P2.div = function(y, b3) {
            return div(this, new BigNumber2(y, b3), DECIMAL_PLACES, ROUNDING_MODE);
          };
          P2.dividedToIntegerBy = P2.idiv = function(y, b3) {
            return div(this, new BigNumber2(y, b3), 0, 1);
          };
          P2.exponentiatedBy = P2.pow = function(n2, m3) {
            var half, isModExp, i, k2, more, nIsBig, nIsNeg, nIsOdd, y, x5 = this;
            n2 = new BigNumber2(n2);
            if (n2.c && !n2.isInteger()) {
              throw Error(bignumberError + "Exponent not an integer: " + valueOf(n2));
            }
            if (m3 != null)
              m3 = new BigNumber2(m3);
            nIsBig = n2.e > 14;
            if (!x5.c || !x5.c[0] || x5.c[0] == 1 && !x5.e && x5.c.length == 1 || !n2.c || !n2.c[0]) {
              y = new BigNumber2(Math.pow(+valueOf(x5), nIsBig ? n2.s * (2 - isOdd(n2)) : +valueOf(n2)));
              return m3 ? y.mod(m3) : y;
            }
            nIsNeg = n2.s < 0;
            if (m3) {
              if (m3.c ? !m3.c[0] : !m3.s)
                return new BigNumber2(NaN);
              isModExp = !nIsNeg && x5.isInteger() && m3.isInteger();
              if (isModExp)
                x5 = x5.mod(m3);
            } else if (n2.e > 9 && (x5.e > 0 || x5.e < -1 || (x5.e == 0 ? x5.c[0] > 1 || nIsBig && x5.c[1] >= 24e7 : x5.c[0] < 8e13 || nIsBig && x5.c[0] <= 9999975e7))) {
              k2 = x5.s < 0 && isOdd(n2) ? -0 : 0;
              if (x5.e > -1)
                k2 = 1 / k2;
              return new BigNumber2(nIsNeg ? 1 / k2 : k2);
            } else if (POW_PRECISION) {
              k2 = mathceil(POW_PRECISION / LOG_BASE + 2);
            }
            if (nIsBig) {
              half = new BigNumber2(0.5);
              if (nIsNeg)
                n2.s = 1;
              nIsOdd = isOdd(n2);
            } else {
              i = Math.abs(+valueOf(n2));
              nIsOdd = i % 2;
            }
            y = new BigNumber2(ONE);
            for (; ; ) {
              if (nIsOdd) {
                y = y.times(x5);
                if (!y.c)
                  break;
                if (k2) {
                  if (y.c.length > k2)
                    y.c.length = k2;
                } else if (isModExp) {
                  y = y.mod(m3);
                }
              }
              if (i) {
                i = mathfloor(i / 2);
                if (i === 0)
                  break;
                nIsOdd = i % 2;
              } else {
                n2 = n2.times(half);
                round(n2, n2.e + 1, 1);
                if (n2.e > 14) {
                  nIsOdd = isOdd(n2);
                } else {
                  i = +valueOf(n2);
                  if (i === 0)
                    break;
                  nIsOdd = i % 2;
                }
              }
              x5 = x5.times(x5);
              if (k2) {
                if (x5.c && x5.c.length > k2)
                  x5.c.length = k2;
              } else if (isModExp) {
                x5 = x5.mod(m3);
              }
            }
            if (isModExp)
              return y;
            if (nIsNeg)
              y = ONE.div(y);
            return m3 ? y.mod(m3) : k2 ? round(y, POW_PRECISION, ROUNDING_MODE, more) : y;
          };
          P2.integerValue = function(rm) {
            var n2 = new BigNumber2(this);
            if (rm == null)
              rm = ROUNDING_MODE;
            else
              intCheck(rm, 0, 8);
            return round(n2, n2.e + 1, rm);
          };
          P2.isEqualTo = P2.eq = function(y, b3) {
            return compare2(this, new BigNumber2(y, b3)) === 0;
          };
          P2.isFinite = function() {
            return !!this.c;
          };
          P2.isGreaterThan = P2.gt = function(y, b3) {
            return compare2(this, new BigNumber2(y, b3)) > 0;
          };
          P2.isGreaterThanOrEqualTo = P2.gte = function(y, b3) {
            return (b3 = compare2(this, new BigNumber2(y, b3))) === 1 || b3 === 0;
          };
          P2.isInteger = function() {
            return !!this.c && bitFloor(this.e / LOG_BASE) > this.c.length - 2;
          };
          P2.isLessThan = P2.lt = function(y, b3) {
            return compare2(this, new BigNumber2(y, b3)) < 0;
          };
          P2.isLessThanOrEqualTo = P2.lte = function(y, b3) {
            return (b3 = compare2(this, new BigNumber2(y, b3))) === -1 || b3 === 0;
          };
          P2.isNaN = function() {
            return !this.s;
          };
          P2.isNegative = function() {
            return this.s < 0;
          };
          P2.isPositive = function() {
            return this.s > 0;
          };
          P2.isZero = function() {
            return !!this.c && this.c[0] == 0;
          };
          P2.minus = function(y, b3) {
            var i, j2, t2, xLTy, x5 = this, a = x5.s;
            y = new BigNumber2(y, b3);
            b3 = y.s;
            if (!a || !b3)
              return new BigNumber2(NaN);
            if (a != b3) {
              y.s = -b3;
              return x5.plus(y);
            }
            var xe = x5.e / LOG_BASE, ye = y.e / LOG_BASE, xc = x5.c, yc = y.c;
            if (!xe || !ye) {
              if (!xc || !yc)
                return xc ? (y.s = -b3, y) : new BigNumber2(yc ? x5 : NaN);
              if (!xc[0] || !yc[0]) {
                return yc[0] ? (y.s = -b3, y) : new BigNumber2(xc[0] ? x5 : (
                  // IEEE 754 (2008) 6.3: n - n = -0 when rounding to -Infinity
                  ROUNDING_MODE == 3 ? -0 : 0
                ));
              }
            }
            xe = bitFloor(xe);
            ye = bitFloor(ye);
            xc = xc.slice();
            if (a = xe - ye) {
              if (xLTy = a < 0) {
                a = -a;
                t2 = xc;
              } else {
                ye = xe;
                t2 = yc;
              }
              t2.reverse();
              for (b3 = a; b3--; t2.push(0))
                ;
              t2.reverse();
            } else {
              j2 = (xLTy = (a = xc.length) < (b3 = yc.length)) ? a : b3;
              for (a = b3 = 0; b3 < j2; b3++) {
                if (xc[b3] != yc[b3]) {
                  xLTy = xc[b3] < yc[b3];
                  break;
                }
              }
            }
            if (xLTy) {
              t2 = xc;
              xc = yc;
              yc = t2;
              y.s = -y.s;
            }
            b3 = (j2 = yc.length) - (i = xc.length);
            if (b3 > 0)
              for (; b3--; xc[i++] = 0)
                ;
            b3 = BASE - 1;
            for (; j2 > a; ) {
              if (xc[--j2] < yc[j2]) {
                for (i = j2; i && !xc[--i]; xc[i] = b3)
                  ;
                --xc[i];
                xc[j2] += BASE;
              }
              xc[j2] -= yc[j2];
            }
            for (; xc[0] == 0; xc.splice(0, 1), --ye)
              ;
            if (!xc[0]) {
              y.s = ROUNDING_MODE == 3 ? -1 : 1;
              y.c = [y.e = 0];
              return y;
            }
            return normalise(y, xc, ye);
          };
          P2.modulo = P2.mod = function(y, b3) {
            var q, s2, x5 = this;
            y = new BigNumber2(y, b3);
            if (!x5.c || !y.s || y.c && !y.c[0]) {
              return new BigNumber2(NaN);
            } else if (!y.c || x5.c && !x5.c[0]) {
              return new BigNumber2(x5);
            }
            if (MODULO_MODE == 9) {
              s2 = y.s;
              y.s = 1;
              q = div(x5, y, 0, 3);
              y.s = s2;
              q.s *= s2;
            } else {
              q = div(x5, y, 0, MODULO_MODE);
            }
            y = x5.minus(q.times(y));
            if (!y.c[0] && MODULO_MODE == 1)
              y.s = x5.s;
            return y;
          };
          P2.multipliedBy = P2.times = function(y, b3) {
            var c3, e3, i, j2, k2, m3, xcL, xlo, xhi, ycL, ylo, yhi, zc, base, sqrtBase, x5 = this, xc = x5.c, yc = (y = new BigNumber2(y, b3)).c;
            if (!xc || !yc || !xc[0] || !yc[0]) {
              if (!x5.s || !y.s || xc && !xc[0] && !yc || yc && !yc[0] && !xc) {
                y.c = y.e = y.s = null;
              } else {
                y.s *= x5.s;
                if (!xc || !yc) {
                  y.c = y.e = null;
                } else {
                  y.c = [0];
                  y.e = 0;
                }
              }
              return y;
            }
            e3 = bitFloor(x5.e / LOG_BASE) + bitFloor(y.e / LOG_BASE);
            y.s *= x5.s;
            xcL = xc.length;
            ycL = yc.length;
            if (xcL < ycL) {
              zc = xc;
              xc = yc;
              yc = zc;
              i = xcL;
              xcL = ycL;
              ycL = i;
            }
            for (i = xcL + ycL, zc = []; i--; zc.push(0))
              ;
            base = BASE;
            sqrtBase = SQRT_BASE;
            for (i = ycL; --i >= 0; ) {
              c3 = 0;
              ylo = yc[i] % sqrtBase;
              yhi = yc[i] / sqrtBase | 0;
              for (k2 = xcL, j2 = i + k2; j2 > i; ) {
                xlo = xc[--k2] % sqrtBase;
                xhi = xc[k2] / sqrtBase | 0;
                m3 = yhi * xlo + xhi * ylo;
                xlo = ylo * xlo + m3 % sqrtBase * sqrtBase + zc[j2] + c3;
                c3 = (xlo / base | 0) + (m3 / sqrtBase | 0) + yhi * xhi;
                zc[j2--] = xlo % base;
              }
              zc[j2] = c3;
            }
            if (c3) {
              ++e3;
            } else {
              zc.splice(0, 1);
            }
            return normalise(y, zc, e3);
          };
          P2.negated = function() {
            var x5 = new BigNumber2(this);
            x5.s = -x5.s || null;
            return x5;
          };
          P2.plus = function(y, b3) {
            var t2, x5 = this, a = x5.s;
            y = new BigNumber2(y, b3);
            b3 = y.s;
            if (!a || !b3)
              return new BigNumber2(NaN);
            if (a != b3) {
              y.s = -b3;
              return x5.minus(y);
            }
            var xe = x5.e / LOG_BASE, ye = y.e / LOG_BASE, xc = x5.c, yc = y.c;
            if (!xe || !ye) {
              if (!xc || !yc)
                return new BigNumber2(a / 0);
              if (!xc[0] || !yc[0])
                return yc[0] ? y : new BigNumber2(xc[0] ? x5 : a * 0);
            }
            xe = bitFloor(xe);
            ye = bitFloor(ye);
            xc = xc.slice();
            if (a = xe - ye) {
              if (a > 0) {
                ye = xe;
                t2 = yc;
              } else {
                a = -a;
                t2 = xc;
              }
              t2.reverse();
              for (; a--; t2.push(0))
                ;
              t2.reverse();
            }
            a = xc.length;
            b3 = yc.length;
            if (a - b3 < 0) {
              t2 = yc;
              yc = xc;
              xc = t2;
              b3 = a;
            }
            for (a = 0; b3; ) {
              a = (xc[--b3] = xc[b3] + yc[b3] + a) / BASE | 0;
              xc[b3] = BASE === xc[b3] ? 0 : xc[b3] % BASE;
            }
            if (a) {
              xc = [a].concat(xc);
              ++ye;
            }
            return normalise(y, xc, ye);
          };
          P2.precision = P2.sd = function(sd, rm) {
            var c3, n2, v2, x5 = this;
            if (sd != null && sd !== !!sd) {
              intCheck(sd, 1, MAX);
              if (rm == null)
                rm = ROUNDING_MODE;
              else
                intCheck(rm, 0, 8);
              return round(new BigNumber2(x5), sd, rm);
            }
            if (!(c3 = x5.c))
              return null;
            v2 = c3.length - 1;
            n2 = v2 * LOG_BASE + 1;
            if (v2 = c3[v2]) {
              for (; v2 % 10 == 0; v2 /= 10, n2--)
                ;
              for (v2 = c3[0]; v2 >= 10; v2 /= 10, n2++)
                ;
            }
            if (sd && x5.e + 1 > n2)
              n2 = x5.e + 1;
            return n2;
          };
          P2.shiftedBy = function(k2) {
            intCheck(k2, -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER);
            return this.times("1e" + k2);
          };
          P2.squareRoot = P2.sqrt = function() {
            var m3, n2, r, rep, t2, x5 = this, c3 = x5.c, s2 = x5.s, e3 = x5.e, dp = DECIMAL_PLACES + 4, half = new BigNumber2("0.5");
            if (s2 !== 1 || !c3 || !c3[0]) {
              return new BigNumber2(!s2 || s2 < 0 && (!c3 || c3[0]) ? NaN : c3 ? x5 : 1 / 0);
            }
            s2 = Math.sqrt(+valueOf(x5));
            if (s2 == 0 || s2 == 1 / 0) {
              n2 = coeffToString(c3);
              if ((n2.length + e3) % 2 == 0)
                n2 += "0";
              s2 = Math.sqrt(+n2);
              e3 = bitFloor((e3 + 1) / 2) - (e3 < 0 || e3 % 2);
              if (s2 == 1 / 0) {
                n2 = "5e" + e3;
              } else {
                n2 = s2.toExponential();
                n2 = n2.slice(0, n2.indexOf("e") + 1) + e3;
              }
              r = new BigNumber2(n2);
            } else {
              r = new BigNumber2(s2 + "");
            }
            if (r.c[0]) {
              e3 = r.e;
              s2 = e3 + dp;
              if (s2 < 3)
                s2 = 0;
              for (; ; ) {
                t2 = r;
                r = half.times(t2.plus(div(x5, t2, dp, 1)));
                if (coeffToString(t2.c).slice(0, s2) === (n2 = coeffToString(r.c)).slice(0, s2)) {
                  if (r.e < e3)
                    --s2;
                  n2 = n2.slice(s2 - 3, s2 + 1);
                  if (n2 == "9999" || !rep && n2 == "4999") {
                    if (!rep) {
                      round(t2, t2.e + DECIMAL_PLACES + 2, 0);
                      if (t2.times(t2).eq(x5)) {
                        r = t2;
                        break;
                      }
                    }
                    dp += 4;
                    s2 += 4;
                    rep = 1;
                  } else {
                    if (!+n2 || !+n2.slice(1) && n2.charAt(0) == "5") {
                      round(r, r.e + DECIMAL_PLACES + 2, 1);
                      m3 = !r.times(r).eq(x5);
                    }
                    break;
                  }
                }
              }
            }
            return round(r, r.e + DECIMAL_PLACES + 1, ROUNDING_MODE, m3);
          };
          P2.toExponential = function(dp, rm) {
            if (dp != null) {
              intCheck(dp, 0, MAX);
              dp++;
            }
            return format(this, dp, rm, 1);
          };
          P2.toFixed = function(dp, rm) {
            if (dp != null) {
              intCheck(dp, 0, MAX);
              dp = dp + this.e + 1;
            }
            return format(this, dp, rm);
          };
          P2.toFormat = function(dp, rm, format2) {
            var str, x5 = this;
            if (format2 == null) {
              if (dp != null && rm && typeof rm == "object") {
                format2 = rm;
                rm = null;
              } else if (dp && typeof dp == "object") {
                format2 = dp;
                dp = rm = null;
              } else {
                format2 = FORMAT;
              }
            } else if (typeof format2 != "object") {
              throw Error(bignumberError + "Argument not an object: " + format2);
            }
            str = x5.toFixed(dp, rm);
            if (x5.c) {
              var i, arr = str.split("."), g1 = +format2.groupSize, g22 = +format2.secondaryGroupSize, groupSeparator = format2.groupSeparator || "", intPart = arr[0], fractionPart = arr[1], isNeg = x5.s < 0, intDigits = isNeg ? intPart.slice(1) : intPart, len = intDigits.length;
              if (g22) {
                i = g1;
                g1 = g22;
                g22 = i;
                len -= i;
              }
              if (g1 > 0 && len > 0) {
                i = len % g1 || g1;
                intPart = intDigits.substr(0, i);
                for (; i < len; i += g1)
                  intPart += groupSeparator + intDigits.substr(i, g1);
                if (g22 > 0)
                  intPart += groupSeparator + intDigits.slice(i);
                if (isNeg)
                  intPart = "-" + intPart;
              }
              str = fractionPart ? intPart + (format2.decimalSeparator || "") + ((g22 = +format2.fractionGroupSize) ? fractionPart.replace(
                new RegExp("\\d{" + g22 + "}\\B", "g"),
                "$&" + (format2.fractionGroupSeparator || "")
              ) : fractionPart) : intPart;
            }
            return (format2.prefix || "") + str + (format2.suffix || "");
          };
          P2.toFraction = function(md) {
            var d2, d0, d1, d22, e3, exp, n2, n0, n1, q, r, s2, x5 = this, xc = x5.c;
            if (md != null) {
              n2 = new BigNumber2(md);
              if (!n2.isInteger() && (n2.c || n2.s !== 1) || n2.lt(ONE)) {
                throw Error(bignumberError + "Argument " + (n2.isInteger() ? "out of range: " : "not an integer: ") + valueOf(n2));
              }
            }
            if (!xc)
              return new BigNumber2(x5);
            d2 = new BigNumber2(ONE);
            n1 = d0 = new BigNumber2(ONE);
            d1 = n0 = new BigNumber2(ONE);
            s2 = coeffToString(xc);
            e3 = d2.e = s2.length - x5.e - 1;
            d2.c[0] = POWS_TEN[(exp = e3 % LOG_BASE) < 0 ? LOG_BASE + exp : exp];
            md = !md || n2.comparedTo(d2) > 0 ? e3 > 0 ? d2 : n1 : n2;
            exp = MAX_EXP;
            MAX_EXP = 1 / 0;
            n2 = new BigNumber2(s2);
            n0.c[0] = 0;
            for (; ; ) {
              q = div(n2, d2, 0, 1);
              d22 = d0.plus(q.times(d1));
              if (d22.comparedTo(md) == 1)
                break;
              d0 = d1;
              d1 = d22;
              n1 = n0.plus(q.times(d22 = n1));
              n0 = d22;
              d2 = n2.minus(q.times(d22 = d2));
              n2 = d22;
            }
            d22 = div(md.minus(d0), d1, 0, 1);
            n0 = n0.plus(d22.times(n1));
            d0 = d0.plus(d22.times(d1));
            n0.s = n1.s = x5.s;
            e3 = e3 * 2;
            r = div(n1, d1, e3, ROUNDING_MODE).minus(x5).abs().comparedTo(
              div(n0, d0, e3, ROUNDING_MODE).minus(x5).abs()
            ) < 1 ? [n1, d1] : [n0, d0];
            MAX_EXP = exp;
            return r;
          };
          P2.toNumber = function() {
            return +valueOf(this);
          };
          P2.toPrecision = function(sd, rm) {
            if (sd != null)
              intCheck(sd, 1, MAX);
            return format(this, sd, rm, 2);
          };
          P2.toString = function(b3) {
            var str, n2 = this, s2 = n2.s, e3 = n2.e;
            if (e3 === null) {
              if (s2) {
                str = "Infinity";
                if (s2 < 0)
                  str = "-" + str;
              } else {
                str = "NaN";
              }
            } else {
              if (b3 == null) {
                str = e3 <= TO_EXP_NEG || e3 >= TO_EXP_POS ? toExponential(coeffToString(n2.c), e3) : toFixedPoint(coeffToString(n2.c), e3, "0");
              } else if (b3 === 10 && alphabetHasNormalDecimalDigits) {
                n2 = round(new BigNumber2(n2), DECIMAL_PLACES + e3 + 1, ROUNDING_MODE);
                str = toFixedPoint(coeffToString(n2.c), n2.e, "0");
              } else {
                intCheck(b3, 2, ALPHABET.length, "Base");
                str = convertBase(toFixedPoint(coeffToString(n2.c), e3, "0"), 10, b3, s2, true);
              }
              if (s2 < 0 && n2.c[0])
                str = "-" + str;
            }
            return str;
          };
          P2.valueOf = P2.toJSON = function() {
            return valueOf(this);
          };
          P2._isBigNumber = true;
          if (configObject != null)
            BigNumber2.set(configObject);
          return BigNumber2;
        }
        function bitFloor(n2) {
          var i = n2 | 0;
          return n2 > 0 || n2 === i ? i : i - 1;
        }
        function coeffToString(a) {
          var s2, z, i = 1, j2 = a.length, r = a[0] + "";
          for (; i < j2; ) {
            s2 = a[i++] + "";
            z = LOG_BASE - s2.length;
            for (; z--; s2 = "0" + s2)
              ;
            r += s2;
          }
          for (j2 = r.length; r.charCodeAt(--j2) === 48; )
            ;
          return r.slice(0, j2 + 1 || 1);
        }
        function compare2(x5, y) {
          var a, b3, xc = x5.c, yc = y.c, i = x5.s, j2 = y.s, k2 = x5.e, l = y.e;
          if (!i || !j2)
            return null;
          a = xc && !xc[0];
          b3 = yc && !yc[0];
          if (a || b3)
            return a ? b3 ? 0 : -j2 : i;
          if (i != j2)
            return i;
          a = i < 0;
          b3 = k2 == l;
          if (!xc || !yc)
            return b3 ? 0 : !xc ^ a ? 1 : -1;
          if (!b3)
            return k2 > l ^ a ? 1 : -1;
          j2 = (k2 = xc.length) < (l = yc.length) ? k2 : l;
          for (i = 0; i < j2; i++)
            if (xc[i] != yc[i])
              return xc[i] > yc[i] ^ a ? 1 : -1;
          return k2 == l ? 0 : k2 > l ^ a ? 1 : -1;
        }
        function intCheck(n2, min, max, name) {
          if (n2 < min || n2 > max || n2 !== mathfloor(n2)) {
            throw Error(bignumberError + (name || "Argument") + (typeof n2 == "number" ? n2 < min || n2 > max ? " out of range: " : " not an integer: " : " not a primitive number: ") + String(n2));
          }
        }
        function isOdd(n2) {
          var k2 = n2.c.length - 1;
          return bitFloor(n2.e / LOG_BASE) == k2 && n2.c[k2] % 2 != 0;
        }
        function toExponential(str, e3) {
          return (str.length > 1 ? str.charAt(0) + "." + str.slice(1) : str) + (e3 < 0 ? "e" : "e+") + e3;
        }
        function toFixedPoint(str, e3, z) {
          var len, zs;
          if (e3 < 0) {
            for (zs = z + "."; ++e3; zs += z)
              ;
            str = zs + str;
          } else {
            len = str.length;
            if (++e3 > len) {
              for (zs = z, e3 -= len; --e3; zs += z)
                ;
              str += zs;
            } else if (e3 < len) {
              str = str.slice(0, e3) + "." + str.slice(e3);
            }
          }
          return str;
        }
        BigNumber = clone();
        BigNumber["default"] = BigNumber.BigNumber = BigNumber;
        if (typeof define == "function" && define.amd) {
          define(function() {
            return BigNumber;
          });
        } else if (typeof module != "undefined" && module.exports) {
          module.exports = BigNumber;
        } else {
          if (!globalObject) {
            globalObject = typeof self != "undefined" && self ? self : window;
          }
          globalObject.BigNumber = BigNumber;
        }
      })(exports);
    }
  });

  // node_modules/borc/src/decoder.asm.js
  var require_decoder_asm = __commonJS({
    "node_modules/borc/src/decoder.asm.js"(exports, module) {
      module.exports = function decodeAsm(stdlib, foreign, buffer) {
        ;
        var heap = new stdlib.Uint8Array(buffer);
        var pushInt = foreign.pushInt;
        var pushInt32 = foreign.pushInt32;
        var pushInt32Neg = foreign.pushInt32Neg;
        var pushInt64 = foreign.pushInt64;
        var pushInt64Neg = foreign.pushInt64Neg;
        var pushFloat = foreign.pushFloat;
        var pushFloatSingle = foreign.pushFloatSingle;
        var pushFloatDouble = foreign.pushFloatDouble;
        var pushTrue = foreign.pushTrue;
        var pushFalse = foreign.pushFalse;
        var pushUndefined = foreign.pushUndefined;
        var pushNull = foreign.pushNull;
        var pushInfinity = foreign.pushInfinity;
        var pushInfinityNeg = foreign.pushInfinityNeg;
        var pushNaN = foreign.pushNaN;
        var pushNaNNeg = foreign.pushNaNNeg;
        var pushArrayStart = foreign.pushArrayStart;
        var pushArrayStartFixed = foreign.pushArrayStartFixed;
        var pushArrayStartFixed32 = foreign.pushArrayStartFixed32;
        var pushArrayStartFixed64 = foreign.pushArrayStartFixed64;
        var pushObjectStart = foreign.pushObjectStart;
        var pushObjectStartFixed = foreign.pushObjectStartFixed;
        var pushObjectStartFixed32 = foreign.pushObjectStartFixed32;
        var pushObjectStartFixed64 = foreign.pushObjectStartFixed64;
        var pushByteString = foreign.pushByteString;
        var pushByteStringStart = foreign.pushByteStringStart;
        var pushUtf8String = foreign.pushUtf8String;
        var pushUtf8StringStart = foreign.pushUtf8StringStart;
        var pushSimpleUnassigned = foreign.pushSimpleUnassigned;
        var pushTagStart = foreign.pushTagStart;
        var pushTagStart4 = foreign.pushTagStart4;
        var pushTagStart8 = foreign.pushTagStart8;
        var pushTagUnassigned = foreign.pushTagUnassigned;
        var pushBreak = foreign.pushBreak;
        var pow3 = stdlib.Math.pow;
        var offset = 0;
        var inputLength = 0;
        var code = 0;
        function parse(input) {
          input = input | 0;
          offset = 0;
          inputLength = input;
          while ((offset | 0) < (inputLength | 0)) {
            code = jumpTable[heap[offset] & 255](heap[offset] | 0) | 0;
            if ((code | 0) > 0) {
              break;
            }
          }
          return code | 0;
        }
        function checkOffset(n2) {
          n2 = n2 | 0;
          if (((offset | 0) + (n2 | 0) | 0) < (inputLength | 0)) {
            return 0;
          }
          return 1;
        }
        function readUInt16(n2) {
          n2 = n2 | 0;
          return heap[n2 | 0] << 8 | heap[n2 + 1 | 0] | 0;
        }
        function readUInt32(n2) {
          n2 = n2 | 0;
          return heap[n2 | 0] << 24 | heap[n2 + 1 | 0] << 16 | heap[n2 + 2 | 0] << 8 | heap[n2 + 3 | 0] | 0;
        }
        function INT_P(octet) {
          octet = octet | 0;
          pushInt(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function UINT_P_8(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushInt(heap[offset + 1 | 0] | 0);
          offset = offset + 2 | 0;
          return 0;
        }
        function UINT_P_16(octet) {
          octet = octet | 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          pushInt(
            readUInt16(offset + 1 | 0) | 0
          );
          offset = offset + 3 | 0;
          return 0;
        }
        function UINT_P_32(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushInt32(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function UINT_P_64(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushInt64(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0,
            readUInt16(offset + 5 | 0) | 0,
            readUInt16(offset + 7 | 0) | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function INT_N(octet) {
          octet = octet | 0;
          pushInt(-1 - (octet - 32 | 0) | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function UINT_N_8(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushInt(
            -1 - (heap[offset + 1 | 0] | 0) | 0
          );
          offset = offset + 2 | 0;
          return 0;
        }
        function UINT_N_16(octet) {
          octet = octet | 0;
          var val = 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          val = readUInt16(offset + 1 | 0) | 0;
          pushInt(-1 - (val | 0) | 0);
          offset = offset + 3 | 0;
          return 0;
        }
        function UINT_N_32(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushInt32Neg(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function UINT_N_64(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushInt64Neg(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0,
            readUInt16(offset + 5 | 0) | 0,
            readUInt16(offset + 7 | 0) | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function BYTE_STRING(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var step = 0;
          step = octet - 64 | 0;
          if (checkOffset(step | 0) | 0) {
            return 1;
          }
          start = offset + 1 | 0;
          end = (offset + 1 | 0) + (step | 0) | 0;
          pushByteString(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function BYTE_STRING_8(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          length = heap[offset + 1 | 0] | 0;
          start = offset + 2 | 0;
          end = (offset + 2 | 0) + (length | 0) | 0;
          if (checkOffset(length + 1 | 0) | 0) {
            return 1;
          }
          pushByteString(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function BYTE_STRING_16(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          length = readUInt16(offset + 1 | 0) | 0;
          start = offset + 3 | 0;
          end = (offset + 3 | 0) + (length | 0) | 0;
          if (checkOffset(length + 2 | 0) | 0) {
            return 1;
          }
          pushByteString(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function BYTE_STRING_32(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          length = readUInt32(offset + 1 | 0) | 0;
          start = offset + 5 | 0;
          end = (offset + 5 | 0) + (length | 0) | 0;
          if (checkOffset(length + 4 | 0) | 0) {
            return 1;
          }
          pushByteString(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function BYTE_STRING_64(octet) {
          octet = octet | 0;
          return 1;
        }
        function BYTE_STRING_BREAK(octet) {
          octet = octet | 0;
          pushByteStringStart();
          offset = offset + 1 | 0;
          return 0;
        }
        function UTF8_STRING(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var step = 0;
          step = octet - 96 | 0;
          if (checkOffset(step | 0) | 0) {
            return 1;
          }
          start = offset + 1 | 0;
          end = (offset + 1 | 0) + (step | 0) | 0;
          pushUtf8String(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function UTF8_STRING_8(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          length = heap[offset + 1 | 0] | 0;
          start = offset + 2 | 0;
          end = (offset + 2 | 0) + (length | 0) | 0;
          if (checkOffset(length + 1 | 0) | 0) {
            return 1;
          }
          pushUtf8String(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function UTF8_STRING_16(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          length = readUInt16(offset + 1 | 0) | 0;
          start = offset + 3 | 0;
          end = (offset + 3 | 0) + (length | 0) | 0;
          if (checkOffset(length + 2 | 0) | 0) {
            return 1;
          }
          pushUtf8String(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function UTF8_STRING_32(octet) {
          octet = octet | 0;
          var start = 0;
          var end = 0;
          var length = 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          length = readUInt32(offset + 1 | 0) | 0;
          start = offset + 5 | 0;
          end = (offset + 5 | 0) + (length | 0) | 0;
          if (checkOffset(length + 4 | 0) | 0) {
            return 1;
          }
          pushUtf8String(start | 0, end | 0);
          offset = end | 0;
          return 0;
        }
        function UTF8_STRING_64(octet) {
          octet = octet | 0;
          return 1;
        }
        function UTF8_STRING_BREAK(octet) {
          octet = octet | 0;
          pushUtf8StringStart();
          offset = offset + 1 | 0;
          return 0;
        }
        function ARRAY(octet) {
          octet = octet | 0;
          pushArrayStartFixed(octet - 128 | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function ARRAY_8(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushArrayStartFixed(heap[offset + 1 | 0] | 0);
          offset = offset + 2 | 0;
          return 0;
        }
        function ARRAY_16(octet) {
          octet = octet | 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          pushArrayStartFixed(
            readUInt16(offset + 1 | 0) | 0
          );
          offset = offset + 3 | 0;
          return 0;
        }
        function ARRAY_32(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushArrayStartFixed32(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function ARRAY_64(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushArrayStartFixed64(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0,
            readUInt16(offset + 5 | 0) | 0,
            readUInt16(offset + 7 | 0) | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function ARRAY_BREAK(octet) {
          octet = octet | 0;
          pushArrayStart();
          offset = offset + 1 | 0;
          return 0;
        }
        function MAP(octet) {
          octet = octet | 0;
          var step = 0;
          step = octet - 160 | 0;
          if (checkOffset(step | 0) | 0) {
            return 1;
          }
          pushObjectStartFixed(step | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function MAP_8(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushObjectStartFixed(heap[offset + 1 | 0] | 0);
          offset = offset + 2 | 0;
          return 0;
        }
        function MAP_16(octet) {
          octet = octet | 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          pushObjectStartFixed(
            readUInt16(offset + 1 | 0) | 0
          );
          offset = offset + 3 | 0;
          return 0;
        }
        function MAP_32(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushObjectStartFixed32(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function MAP_64(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushObjectStartFixed64(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0,
            readUInt16(offset + 5 | 0) | 0,
            readUInt16(offset + 7 | 0) | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function MAP_BREAK(octet) {
          octet = octet | 0;
          pushObjectStart();
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_KNOWN(octet) {
          octet = octet | 0;
          pushTagStart(octet - 192 | 0 | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BIGNUM_POS(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BIGNUM_NEG(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_FRAC(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BIGNUM_FLOAT(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_UNASSIGNED(octet) {
          octet = octet | 0;
          pushTagStart(octet - 192 | 0 | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BASE64_URL(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BASE64(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_BASE16(octet) {
          octet = octet | 0;
          pushTagStart(octet | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function TAG_MORE_1(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushTagStart(heap[offset + 1 | 0] | 0);
          offset = offset + 2 | 0;
          return 0;
        }
        function TAG_MORE_2(octet) {
          octet = octet | 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          pushTagStart(
            readUInt16(offset + 1 | 0) | 0
          );
          offset = offset + 3 | 0;
          return 0;
        }
        function TAG_MORE_4(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushTagStart4(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function TAG_MORE_8(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushTagStart8(
            readUInt16(offset + 1 | 0) | 0,
            readUInt16(offset + 3 | 0) | 0,
            readUInt16(offset + 5 | 0) | 0,
            readUInt16(offset + 7 | 0) | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function SIMPLE_UNASSIGNED(octet) {
          octet = octet | 0;
          pushSimpleUnassigned((octet | 0) - 224 | 0);
          offset = offset + 1 | 0;
          return 0;
        }
        function SIMPLE_FALSE(octet) {
          octet = octet | 0;
          pushFalse();
          offset = offset + 1 | 0;
          return 0;
        }
        function SIMPLE_TRUE(octet) {
          octet = octet | 0;
          pushTrue();
          offset = offset + 1 | 0;
          return 0;
        }
        function SIMPLE_NULL(octet) {
          octet = octet | 0;
          pushNull();
          offset = offset + 1 | 0;
          return 0;
        }
        function SIMPLE_UNDEFINED(octet) {
          octet = octet | 0;
          pushUndefined();
          offset = offset + 1 | 0;
          return 0;
        }
        function SIMPLE_BYTE(octet) {
          octet = octet | 0;
          if (checkOffset(1) | 0) {
            return 1;
          }
          pushSimpleUnassigned(heap[offset + 1 | 0] | 0);
          offset = offset + 2 | 0;
          return 0;
        }
        function SIMPLE_FLOAT_HALF(octet) {
          octet = octet | 0;
          var f4 = 0;
          var g3 = 0;
          var sign = 1;
          var exp = 0;
          var mant = 0;
          var r = 0;
          if (checkOffset(2) | 0) {
            return 1;
          }
          f4 = heap[offset + 1 | 0] | 0;
          g3 = heap[offset + 2 | 0] | 0;
          if ((f4 | 0) & 128) {
            sign = -1;
          }
          exp = +(((f4 | 0) & 124) >> 2);
          mant = +(((f4 | 0) & 3) << 8 | g3);
          if (+exp == 0) {
            pushFloat(+(+sign * 5960464477539063e-23 * +mant));
          } else if (+exp == 31) {
            if (+sign == 1) {
              if (+mant > 0) {
                pushNaN();
              } else {
                pushInfinity();
              }
            } else {
              if (+mant > 0) {
                pushNaNNeg();
              } else {
                pushInfinityNeg();
              }
            }
          } else {
            pushFloat(+(+sign * pow3(2, +(+exp - 25)) * +(1024 + mant)));
          }
          offset = offset + 3 | 0;
          return 0;
        }
        function SIMPLE_FLOAT_SINGLE(octet) {
          octet = octet | 0;
          if (checkOffset(4) | 0) {
            return 1;
          }
          pushFloatSingle(
            heap[offset + 1 | 0] | 0,
            heap[offset + 2 | 0] | 0,
            heap[offset + 3 | 0] | 0,
            heap[offset + 4 | 0] | 0
          );
          offset = offset + 5 | 0;
          return 0;
        }
        function SIMPLE_FLOAT_DOUBLE(octet) {
          octet = octet | 0;
          if (checkOffset(8) | 0) {
            return 1;
          }
          pushFloatDouble(
            heap[offset + 1 | 0] | 0,
            heap[offset + 2 | 0] | 0,
            heap[offset + 3 | 0] | 0,
            heap[offset + 4 | 0] | 0,
            heap[offset + 5 | 0] | 0,
            heap[offset + 6 | 0] | 0,
            heap[offset + 7 | 0] | 0,
            heap[offset + 8 | 0] | 0
          );
          offset = offset + 9 | 0;
          return 0;
        }
        function ERROR(octet) {
          octet = octet | 0;
          return 1;
        }
        function BREAK(octet) {
          octet = octet | 0;
          pushBreak();
          offset = offset + 1 | 0;
          return 0;
        }
        var jumpTable = [
          // Integer 0x00..0x17 (0..23)
          INT_P,
          // 0x00
          INT_P,
          // 0x01
          INT_P,
          // 0x02
          INT_P,
          // 0x03
          INT_P,
          // 0x04
          INT_P,
          // 0x05
          INT_P,
          // 0x06
          INT_P,
          // 0x07
          INT_P,
          // 0x08
          INT_P,
          // 0x09
          INT_P,
          // 0x0A
          INT_P,
          // 0x0B
          INT_P,
          // 0x0C
          INT_P,
          // 0x0D
          INT_P,
          // 0x0E
          INT_P,
          // 0x0F
          INT_P,
          // 0x10
          INT_P,
          // 0x11
          INT_P,
          // 0x12
          INT_P,
          // 0x13
          INT_P,
          // 0x14
          INT_P,
          // 0x15
          INT_P,
          // 0x16
          INT_P,
          // 0x17
          // Unsigned integer (one-byte uint8_t follows)
          UINT_P_8,
          // 0x18
          // Unsigned integer (two-byte uint16_t follows)
          UINT_P_16,
          // 0x19
          // Unsigned integer (four-byte uint32_t follows)
          UINT_P_32,
          // 0x1a
          // Unsigned integer (eight-byte uint64_t follows)
          UINT_P_64,
          // 0x1b
          ERROR,
          // 0x1c
          ERROR,
          // 0x1d
          ERROR,
          // 0x1e
          ERROR,
          // 0x1f
          // Negative integer -1-0x00..-1-0x17 (-1..-24)
          INT_N,
          // 0x20
          INT_N,
          // 0x21
          INT_N,
          // 0x22
          INT_N,
          // 0x23
          INT_N,
          // 0x24
          INT_N,
          // 0x25
          INT_N,
          // 0x26
          INT_N,
          // 0x27
          INT_N,
          // 0x28
          INT_N,
          // 0x29
          INT_N,
          // 0x2A
          INT_N,
          // 0x2B
          INT_N,
          // 0x2C
          INT_N,
          // 0x2D
          INT_N,
          // 0x2E
          INT_N,
          // 0x2F
          INT_N,
          // 0x30
          INT_N,
          // 0x31
          INT_N,
          // 0x32
          INT_N,
          // 0x33
          INT_N,
          // 0x34
          INT_N,
          // 0x35
          INT_N,
          // 0x36
          INT_N,
          // 0x37
          // Negative integer -1-n (one-byte uint8_t for n follows)
          UINT_N_8,
          // 0x38
          // Negative integer -1-n (two-byte uint16_t for n follows)
          UINT_N_16,
          // 0x39
          // Negative integer -1-n (four-byte uint32_t for nfollows)
          UINT_N_32,
          // 0x3a
          // Negative integer -1-n (eight-byte uint64_t for n follows)
          UINT_N_64,
          // 0x3b
          ERROR,
          // 0x3c
          ERROR,
          // 0x3d
          ERROR,
          // 0x3e
          ERROR,
          // 0x3f
          // byte string (0x00..0x17 bytes follow)
          BYTE_STRING,
          // 0x40
          BYTE_STRING,
          // 0x41
          BYTE_STRING,
          // 0x42
          BYTE_STRING,
          // 0x43
          BYTE_STRING,
          // 0x44
          BYTE_STRING,
          // 0x45
          BYTE_STRING,
          // 0x46
          BYTE_STRING,
          // 0x47
          BYTE_STRING,
          // 0x48
          BYTE_STRING,
          // 0x49
          BYTE_STRING,
          // 0x4A
          BYTE_STRING,
          // 0x4B
          BYTE_STRING,
          // 0x4C
          BYTE_STRING,
          // 0x4D
          BYTE_STRING,
          // 0x4E
          BYTE_STRING,
          // 0x4F
          BYTE_STRING,
          // 0x50
          BYTE_STRING,
          // 0x51
          BYTE_STRING,
          // 0x52
          BYTE_STRING,
          // 0x53
          BYTE_STRING,
          // 0x54
          BYTE_STRING,
          // 0x55
          BYTE_STRING,
          // 0x56
          BYTE_STRING,
          // 0x57
          // byte string (one-byte uint8_t for n, and then n bytes follow)
          BYTE_STRING_8,
          // 0x58
          // byte string (two-byte uint16_t for n, and then n bytes follow)
          BYTE_STRING_16,
          // 0x59
          // byte string (four-byte uint32_t for n, and then n bytes follow)
          BYTE_STRING_32,
          // 0x5a
          // byte string (eight-byte uint64_t for n, and then n bytes follow)
          BYTE_STRING_64,
          // 0x5b
          ERROR,
          // 0x5c
          ERROR,
          // 0x5d
          ERROR,
          // 0x5e
          // byte string, byte strings follow, terminated by "break"
          BYTE_STRING_BREAK,
          // 0x5f
          // UTF-8 string (0x00..0x17 bytes follow)
          UTF8_STRING,
          // 0x60
          UTF8_STRING,
          // 0x61
          UTF8_STRING,
          // 0x62
          UTF8_STRING,
          // 0x63
          UTF8_STRING,
          // 0x64
          UTF8_STRING,
          // 0x65
          UTF8_STRING,
          // 0x66
          UTF8_STRING,
          // 0x67
          UTF8_STRING,
          // 0x68
          UTF8_STRING,
          // 0x69
          UTF8_STRING,
          // 0x6A
          UTF8_STRING,
          // 0x6B
          UTF8_STRING,
          // 0x6C
          UTF8_STRING,
          // 0x6D
          UTF8_STRING,
          // 0x6E
          UTF8_STRING,
          // 0x6F
          UTF8_STRING,
          // 0x70
          UTF8_STRING,
          // 0x71
          UTF8_STRING,
          // 0x72
          UTF8_STRING,
          // 0x73
          UTF8_STRING,
          // 0x74
          UTF8_STRING,
          // 0x75
          UTF8_STRING,
          // 0x76
          UTF8_STRING,
          // 0x77
          // UTF-8 string (one-byte uint8_t for n, and then n bytes follow)
          UTF8_STRING_8,
          // 0x78
          // UTF-8 string (two-byte uint16_t for n, and then n bytes follow)
          UTF8_STRING_16,
          // 0x79
          // UTF-8 string (four-byte uint32_t for n, and then n bytes follow)
          UTF8_STRING_32,
          // 0x7a
          // UTF-8 string (eight-byte uint64_t for n, and then n bytes follow)
          UTF8_STRING_64,
          // 0x7b
          // UTF-8 string, UTF-8 strings follow, terminated by "break"
          ERROR,
          // 0x7c
          ERROR,
          // 0x7d
          ERROR,
          // 0x7e
          UTF8_STRING_BREAK,
          // 0x7f
          // array (0x00..0x17 data items follow)
          ARRAY,
          // 0x80
          ARRAY,
          // 0x81
          ARRAY,
          // 0x82
          ARRAY,
          // 0x83
          ARRAY,
          // 0x84
          ARRAY,
          // 0x85
          ARRAY,
          // 0x86
          ARRAY,
          // 0x87
          ARRAY,
          // 0x88
          ARRAY,
          // 0x89
          ARRAY,
          // 0x8A
          ARRAY,
          // 0x8B
          ARRAY,
          // 0x8C
          ARRAY,
          // 0x8D
          ARRAY,
          // 0x8E
          ARRAY,
          // 0x8F
          ARRAY,
          // 0x90
          ARRAY,
          // 0x91
          ARRAY,
          // 0x92
          ARRAY,
          // 0x93
          ARRAY,
          // 0x94
          ARRAY,
          // 0x95
          ARRAY,
          // 0x96
          ARRAY,
          // 0x97
          // array (one-byte uint8_t fo, and then n data items follow)
          ARRAY_8,
          // 0x98
          // array (two-byte uint16_t for n, and then n data items follow)
          ARRAY_16,
          // 0x99
          // array (four-byte uint32_t for n, and then n data items follow)
          ARRAY_32,
          // 0x9a
          // array (eight-byte uint64_t for n, and then n data items follow)
          ARRAY_64,
          // 0x9b
          // array, data items follow, terminated by "break"
          ERROR,
          // 0x9c
          ERROR,
          // 0x9d
          ERROR,
          // 0x9e
          ARRAY_BREAK,
          // 0x9f
          // map (0x00..0x17 pairs of data items follow)
          MAP,
          // 0xa0
          MAP,
          // 0xa1
          MAP,
          // 0xa2
          MAP,
          // 0xa3
          MAP,
          // 0xa4
          MAP,
          // 0xa5
          MAP,
          // 0xa6
          MAP,
          // 0xa7
          MAP,
          // 0xa8
          MAP,
          // 0xa9
          MAP,
          // 0xaA
          MAP,
          // 0xaB
          MAP,
          // 0xaC
          MAP,
          // 0xaD
          MAP,
          // 0xaE
          MAP,
          // 0xaF
          MAP,
          // 0xb0
          MAP,
          // 0xb1
          MAP,
          // 0xb2
          MAP,
          // 0xb3
          MAP,
          // 0xb4
          MAP,
          // 0xb5
          MAP,
          // 0xb6
          MAP,
          // 0xb7
          // map (one-byte uint8_t for n, and then n pairs of data items follow)
          MAP_8,
          // 0xb8
          // map (two-byte uint16_t for n, and then n pairs of data items follow)
          MAP_16,
          // 0xb9
          // map (four-byte uint32_t for n, and then n pairs of data items follow)
          MAP_32,
          // 0xba
          // map (eight-byte uint64_t for n, and then n pairs of data items follow)
          MAP_64,
          // 0xbb
          ERROR,
          // 0xbc
          ERROR,
          // 0xbd
          ERROR,
          // 0xbe
          // map, pairs of data items follow, terminated by "break"
          MAP_BREAK,
          // 0xbf
          // Text-based date/time (data item follows; see Section 2.4.1)
          TAG_KNOWN,
          // 0xc0
          // Epoch-based date/time (data item follows; see Section 2.4.1)
          TAG_KNOWN,
          // 0xc1
          // Positive bignum (data item "byte string" follows)
          TAG_KNOWN,
          // 0xc2
          // Negative bignum (data item "byte string" follows)
          TAG_KNOWN,
          // 0xc3
          // Decimal Fraction (data item "array" follows; see Section 2.4.3)
          TAG_KNOWN,
          // 0xc4
          // Bigfloat (data item "array" follows; see Section 2.4.3)
          TAG_KNOWN,
          // 0xc5
          // (tagged item)
          TAG_UNASSIGNED,
          // 0xc6
          TAG_UNASSIGNED,
          // 0xc7
          TAG_UNASSIGNED,
          // 0xc8
          TAG_UNASSIGNED,
          // 0xc9
          TAG_UNASSIGNED,
          // 0xca
          TAG_UNASSIGNED,
          // 0xcb
          TAG_UNASSIGNED,
          // 0xcc
          TAG_UNASSIGNED,
          // 0xcd
          TAG_UNASSIGNED,
          // 0xce
          TAG_UNASSIGNED,
          // 0xcf
          TAG_UNASSIGNED,
          // 0xd0
          TAG_UNASSIGNED,
          // 0xd1
          TAG_UNASSIGNED,
          // 0xd2
          TAG_UNASSIGNED,
          // 0xd3
          TAG_UNASSIGNED,
          // 0xd4
          // Expected Conversion (data item follows; see Section 2.4.4.2)
          TAG_UNASSIGNED,
          // 0xd5
          TAG_UNASSIGNED,
          // 0xd6
          TAG_UNASSIGNED,
          // 0xd7
          // (more tagged items, 1/2/4/8 bytes and then a data item follow)
          TAG_MORE_1,
          // 0xd8
          TAG_MORE_2,
          // 0xd9
          TAG_MORE_4,
          // 0xda
          TAG_MORE_8,
          // 0xdb
          ERROR,
          // 0xdc
          ERROR,
          // 0xdd
          ERROR,
          // 0xde
          ERROR,
          // 0xdf
          // (simple value)
          SIMPLE_UNASSIGNED,
          // 0xe0
          SIMPLE_UNASSIGNED,
          // 0xe1
          SIMPLE_UNASSIGNED,
          // 0xe2
          SIMPLE_UNASSIGNED,
          // 0xe3
          SIMPLE_UNASSIGNED,
          // 0xe4
          SIMPLE_UNASSIGNED,
          // 0xe5
          SIMPLE_UNASSIGNED,
          // 0xe6
          SIMPLE_UNASSIGNED,
          // 0xe7
          SIMPLE_UNASSIGNED,
          // 0xe8
          SIMPLE_UNASSIGNED,
          // 0xe9
          SIMPLE_UNASSIGNED,
          // 0xea
          SIMPLE_UNASSIGNED,
          // 0xeb
          SIMPLE_UNASSIGNED,
          // 0xec
          SIMPLE_UNASSIGNED,
          // 0xed
          SIMPLE_UNASSIGNED,
          // 0xee
          SIMPLE_UNASSIGNED,
          // 0xef
          SIMPLE_UNASSIGNED,
          // 0xf0
          SIMPLE_UNASSIGNED,
          // 0xf1
          SIMPLE_UNASSIGNED,
          // 0xf2
          SIMPLE_UNASSIGNED,
          // 0xf3
          // False
          SIMPLE_FALSE,
          // 0xf4
          // True
          SIMPLE_TRUE,
          // 0xf5
          // Null
          SIMPLE_NULL,
          // 0xf6
          // Undefined
          SIMPLE_UNDEFINED,
          // 0xf7
          // (simple value, one byte follows)
          SIMPLE_BYTE,
          // 0xf8
          // Half-Precision Float (two-byte IEEE 754)
          SIMPLE_FLOAT_HALF,
          // 0xf9
          // Single-Precision Float (four-byte IEEE 754)
          SIMPLE_FLOAT_SINGLE,
          // 0xfa
          // Double-Precision Float (eight-byte IEEE 754)
          SIMPLE_FLOAT_DOUBLE,
          // 0xfb
          ERROR,
          // 0xfc
          ERROR,
          // 0xfd
          ERROR,
          // 0xfe
          // "break" stop code
          BREAK
          // 0xff
        ];
        return {
          parse
        };
      };
    }
  });

  // node_modules/borc/src/constants.js
  var require_constants = __commonJS({
    "node_modules/borc/src/constants.js"(exports) {
      "use strict";
      var Bignumber = require_bignumber().BigNumber;
      exports.MT = {
        POS_INT: 0,
        NEG_INT: 1,
        BYTE_STRING: 2,
        UTF8_STRING: 3,
        ARRAY: 4,
        MAP: 5,
        TAG: 6,
        SIMPLE_FLOAT: 7
      };
      exports.TAG = {
        DATE_STRING: 0,
        DATE_EPOCH: 1,
        POS_BIGINT: 2,
        NEG_BIGINT: 3,
        DECIMAL_FRAC: 4,
        BIGFLOAT: 5,
        BASE64URL_EXPECTED: 21,
        BASE64_EXPECTED: 22,
        BASE16_EXPECTED: 23,
        CBOR: 24,
        URI: 32,
        BASE64URL: 33,
        BASE64: 34,
        REGEXP: 35,
        MIME: 36
      };
      exports.NUMBYTES = {
        ZERO: 0,
        ONE: 24,
        TWO: 25,
        FOUR: 26,
        EIGHT: 27,
        INDEFINITE: 31
      };
      exports.SIMPLE = {
        FALSE: 20,
        TRUE: 21,
        NULL: 22,
        UNDEFINED: 23
      };
      exports.SYMS = {
        NULL: Symbol("null"),
        UNDEFINED: Symbol("undef"),
        PARENT: Symbol("parent"),
        BREAK: Symbol("break"),
        STREAM: Symbol("stream")
      };
      exports.SHIFT32 = Math.pow(2, 32);
      exports.SHIFT16 = Math.pow(2, 16);
      exports.MAX_SAFE_HIGH = 2097151;
      exports.NEG_ONE = new Bignumber(-1);
      exports.TEN = new Bignumber(10);
      exports.TWO = new Bignumber(2);
      exports.PARENT = {
        ARRAY: 0,
        OBJECT: 1,
        MAP: 2,
        TAG: 3,
        BYTE_STRING: 4,
        UTF8_STRING: 5
      };
    }
  });

  // node_modules/borc/src/utils.js
  var require_utils = __commonJS({
    "node_modules/borc/src/utils.js"(exports) {
      "use strict";
      var { Buffer: Buffer3 } = require_buffer2();
      var Bignumber = require_bignumber().BigNumber;
      var constants = require_constants();
      var SHIFT32 = constants.SHIFT32;
      var SHIFT16 = constants.SHIFT16;
      var MAX_SAFE_HIGH = 2097151;
      exports.parseHalf = function parseHalf(buf) {
        var exp, mant, sign;
        sign = buf[0] & 128 ? -1 : 1;
        exp = (buf[0] & 124) >> 2;
        mant = (buf[0] & 3) << 8 | buf[1];
        if (!exp) {
          return sign * 5960464477539063e-23 * mant;
        } else if (exp === 31) {
          return sign * (mant ? 0 / 0 : Infinity);
        } else {
          return sign * Math.pow(2, exp - 25) * (1024 + mant);
        }
      };
      function toHex2(n2) {
        if (n2 < 16) {
          return "0" + n2.toString(16);
        }
        return n2.toString(16);
      }
      exports.arrayBufferToBignumber = function(buf) {
        const len = buf.byteLength;
        let res = "";
        for (let i = 0; i < len; i++) {
          res += toHex2(buf[i]);
        }
        return new Bignumber(res, 16);
      };
      exports.buildMap = (obj) => {
        const res = /* @__PURE__ */ new Map();
        const keys = Object.keys(obj);
        const length = keys.length;
        for (let i = 0; i < length; i++) {
          res.set(keys[i], obj[keys[i]]);
        }
        return res;
      };
      exports.buildInt32 = (f4, g3) => {
        return f4 * SHIFT16 + g3;
      };
      exports.buildInt64 = (f1, f22, g1, g22) => {
        const f4 = exports.buildInt32(f1, f22);
        const g3 = exports.buildInt32(g1, g22);
        if (f4 > MAX_SAFE_HIGH) {
          return new Bignumber(f4).times(SHIFT32).plus(g3);
        } else {
          return f4 * SHIFT32 + g3;
        }
      };
      exports.writeHalf = function writeHalf(buf, half) {
        const u32 = Buffer3.allocUnsafe(4);
        u32.writeFloatBE(half, 0);
        const u2 = u32.readUInt32BE(0);
        if ((u2 & 8191) !== 0) {
          return false;
        }
        var s16 = u2 >> 16 & 32768;
        const exp = u2 >> 23 & 255;
        const mant = u2 & 8388607;
        if (exp >= 113 && exp <= 142) {
          s16 += (exp - 112 << 10) + (mant >> 13);
        } else if (exp >= 103 && exp < 113) {
          if (mant & (1 << 126 - exp) - 1) {
            return false;
          }
          s16 += mant + 8388608 >> 126 - exp;
        } else {
          return false;
        }
        buf.writeUInt16BE(s16, 0);
        return true;
      };
      exports.keySorter = function(a, b3) {
        var lenA = a[0].byteLength;
        var lenB = b3[0].byteLength;
        if (lenA > lenB) {
          return 1;
        }
        if (lenB > lenA) {
          return -1;
        }
        return a[0].compare(b3[0]);
      };
      exports.isNegativeZero = (x5) => {
        return x5 === 0 && 1 / x5 < 0;
      };
      exports.nextPowerOf2 = (n2) => {
        let count = 0;
        if (n2 && !(n2 & n2 - 1)) {
          return n2;
        }
        while (n2 !== 0) {
          n2 >>= 1;
          count += 1;
        }
        return 1 << count;
      };
    }
  });

  // node_modules/borc/src/simple.js
  var require_simple = __commonJS({
    "node_modules/borc/src/simple.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      var MT = constants.MT;
      var SIMPLE = constants.SIMPLE;
      var SYMS = constants.SYMS;
      var Simple = class _Simple {
        /**
         * Creates an instance of Simple.
         *
         * @param {integer} value - the simple value's integer value
         */
        constructor(value4) {
          if (typeof value4 !== "number") {
            throw new Error("Invalid Simple type: " + typeof value4);
          }
          if (value4 < 0 || value4 > 255 || (value4 | 0) !== value4) {
            throw new Error("value must be a small positive integer: " + value4);
          }
          this.value = value4;
        }
        /**
         * Debug string for simple value
         *
         * @returns {string} simple(value)
         */
        toString() {
          return "simple(" + this.value + ")";
        }
        /**
         * Debug string for simple value
         *
         * @returns {string} simple(value)
         */
        inspect() {
          return "simple(" + this.value + ")";
        }
        /**
         * Push the simple value onto the CBOR stream
         *
         * @param {cbor.Encoder} gen The generator to push onto
         * @returns {number}
         */
        encodeCBOR(gen) {
          return gen._pushInt(this.value, MT.SIMPLE_FLOAT);
        }
        /**
         * Is the given object a Simple?
         *
         * @param {any} obj - object to test
         * @returns {bool} - is it Simple?
         */
        static isSimple(obj) {
          return obj instanceof _Simple;
        }
        /**
         * Decode from the CBOR additional information into a JavaScript value.
         * If the CBOR item has no parent, return a "safe" symbol instead of
         * `null` or `undefined`, so that the value can be passed through a
         * stream in object mode.
         *
         * @param {Number} val - the CBOR additional info to convert
         * @param {bool} hasParent - Does the CBOR item have a parent?
         * @returns {(null|undefined|Boolean|Symbol)} - the decoded value
         */
        static decode(val, hasParent) {
          if (hasParent == null) {
            hasParent = true;
          }
          switch (val) {
            case SIMPLE.FALSE:
              return false;
            case SIMPLE.TRUE:
              return true;
            case SIMPLE.NULL:
              if (hasParent) {
                return null;
              } else {
                return SYMS.NULL;
              }
            case SIMPLE.UNDEFINED:
              if (hasParent) {
                return void 0;
              } else {
                return SYMS.UNDEFINED;
              }
            case -1:
              if (!hasParent) {
                throw new Error("Invalid BREAK");
              }
              return SYMS.BREAK;
            default:
              return new _Simple(val);
          }
        }
      };
      module.exports = Simple;
    }
  });

  // node_modules/borc/src/tagged.js
  var require_tagged = __commonJS({
    "node_modules/borc/src/tagged.js"(exports, module) {
      "use strict";
      var Tagged = class _Tagged {
        /**
         * Creates an instance of Tagged.
         *
         * @param {Number} tag - the number of the tag
         * @param {any} value - the value inside the tag
         * @param {Error} err - the error that was thrown parsing the tag, or null
         */
        constructor(tag, value4, err) {
          this.tag = tag;
          this.value = value4;
          this.err = err;
          if (typeof this.tag !== "number") {
            throw new Error("Invalid tag type (" + typeof this.tag + ")");
          }
          if (this.tag < 0 || (this.tag | 0) !== this.tag) {
            throw new Error("Tag must be a positive integer: " + this.tag);
          }
        }
        /**
         * Convert to a String
         *
         * @returns {String} string of the form '1(2)'
         */
        toString() {
          return `${this.tag}(${JSON.stringify(this.value)})`;
        }
        /**
         * Push the simple value onto the CBOR stream
         *
         * @param {cbor.Encoder} gen The generator to push onto
         * @returns {number}
         */
        encodeCBOR(gen) {
          gen._pushTag(this.tag);
          return gen.pushAny(this.value);
        }
        /**
         * If we have a converter for this type, do the conversion.  Some converters
         * are built-in.  Additional ones can be passed in.  If you want to remove
         * a built-in converter, pass a converter in whose value is 'null' instead
         * of a function.
         *
         * @param {Object} converters - keys in the object are a tag number, the value
         *   is a function that takes the decoded CBOR and returns a JavaScript value
         *   of the appropriate type.  Throw an exception in the function on errors.
         * @returns {any} - the converted item
         */
        convert(converters) {
          var er, f4;
          f4 = converters != null ? converters[this.tag] : void 0;
          if (typeof f4 !== "function") {
            f4 = _Tagged["_tag" + this.tag];
            if (typeof f4 !== "function") {
              return this;
            }
          }
          try {
            return f4.call(_Tagged, this.value);
          } catch (error) {
            er = error;
            this.err = er;
            return this;
          }
        }
      };
      module.exports = Tagged;
    }
  });

  // node_modules/iso-url/src/url-browser.js
  var require_url_browser = __commonJS({
    "node_modules/iso-url/src/url-browser.js"(exports, module) {
      "use strict";
      var defaultBase = self.location ? self.location.protocol + "//" + self.location.host : "";
      var URL2 = self.URL;
      var URLWithLegacySupport = class {
        constructor(url = "", base = defaultBase) {
          this.super = new URL2(url, base);
          this.path = this.pathname + this.search;
          this.auth = this.username && this.password ? this.username + ":" + this.password : null;
          this.query = this.search && this.search.startsWith("?") ? this.search.slice(1) : null;
        }
        get hash() {
          return this.super.hash;
        }
        get host() {
          return this.super.host;
        }
        get hostname() {
          return this.super.hostname;
        }
        get href() {
          return this.super.href;
        }
        get origin() {
          return this.super.origin;
        }
        get password() {
          return this.super.password;
        }
        get pathname() {
          return this.super.pathname;
        }
        get port() {
          return this.super.port;
        }
        get protocol() {
          return this.super.protocol;
        }
        get search() {
          return this.super.search;
        }
        get searchParams() {
          return this.super.searchParams;
        }
        get username() {
          return this.super.username;
        }
        set hash(hash2) {
          this.super.hash = hash2;
        }
        set host(host) {
          this.super.host = host;
        }
        set hostname(hostname) {
          this.super.hostname = hostname;
        }
        set href(href) {
          this.super.href = href;
        }
        set origin(origin) {
          this.super.origin = origin;
        }
        set password(password) {
          this.super.password = password;
        }
        set pathname(pathname) {
          this.super.pathname = pathname;
        }
        set port(port) {
          this.super.port = port;
        }
        set protocol(protocol) {
          this.super.protocol = protocol;
        }
        set search(search) {
          this.super.search = search;
        }
        set searchParams(searchParams) {
          this.super.searchParams = searchParams;
        }
        set username(username) {
          this.super.username = username;
        }
        createObjectURL(o) {
          return this.super.createObjectURL(o);
        }
        revokeObjectURL(o) {
          this.super.revokeObjectURL(o);
        }
        toJSON() {
          return this.super.toJSON();
        }
        toString() {
          return this.super.toString();
        }
        format() {
          return this.toString();
        }
      };
      function format(obj) {
        if (typeof obj === "string") {
          const url = new URL2(obj);
          return url.toString();
        }
        if (!(obj instanceof URL2)) {
          const userPass = obj.username && obj.password ? `${obj.username}:${obj.password}@` : "";
          const auth = obj.auth ? obj.auth + "@" : "";
          const port = obj.port ? ":" + obj.port : "";
          const protocol = obj.protocol ? obj.protocol + "//" : "";
          const host = obj.host || "";
          const hostname = obj.hostname || "";
          const search = obj.search || (obj.query ? "?" + obj.query : "");
          const hash2 = obj.hash || "";
          const pathname = obj.pathname || "";
          const path = obj.path || pathname + search;
          return `${protocol}${userPass || auth}${host || hostname + port}${path}${hash2}`;
        }
      }
      module.exports = {
        URLWithLegacySupport,
        URLSearchParams: self.URLSearchParams,
        defaultBase,
        format
      };
    }
  });

  // node_modules/iso-url/src/relative.js
  var require_relative = __commonJS({
    "node_modules/iso-url/src/relative.js"(exports, module) {
      "use strict";
      var { URLWithLegacySupport, format } = require_url_browser();
      module.exports = (url, location2 = {}, protocolMap = {}, defaultProtocol) => {
        let protocol = location2.protocol ? location2.protocol.replace(":", "") : "http";
        protocol = (protocolMap[protocol] || defaultProtocol || protocol) + ":";
        let urlParsed;
        try {
          urlParsed = new URLWithLegacySupport(url);
        } catch (err) {
          urlParsed = {};
        }
        const base = Object.assign({}, location2, {
          protocol: protocol || urlParsed.protocol,
          host: location2.host || urlParsed.host
        });
        return new URLWithLegacySupport(url, format(base)).toString();
      };
    }
  });

  // node_modules/iso-url/index.js
  var require_iso_url = __commonJS({
    "node_modules/iso-url/index.js"(exports, module) {
      "use strict";
      var {
        URLWithLegacySupport,
        format,
        URLSearchParams,
        defaultBase
      } = require_url_browser();
      var relative = require_relative();
      module.exports = {
        URL: URLWithLegacySupport,
        URLSearchParams,
        format,
        relative,
        defaultBase
      };
    }
  });

  // node_modules/borc/src/decoder.js
  var require_decoder = __commonJS({
    "node_modules/borc/src/decoder.js"(exports, module) {
      "use strict";
      var { Buffer: Buffer3 } = require_buffer2();
      var ieee754 = require_ieee754();
      var Bignumber = require_bignumber().BigNumber;
      var parser = require_decoder_asm();
      var utils = require_utils();
      var c3 = require_constants();
      var Simple = require_simple();
      var Tagged = require_tagged();
      var { URL: URL2 } = require_iso_url();
      var Decoder = class _Decoder {
        /**
         * @param {Object} [opts={}]
         * @param {number} [opts.size=65536] - Size of the allocated heap.
         */
        constructor(opts) {
          opts = opts || {};
          if (!opts.size || opts.size < 65536) {
            opts.size = 65536;
          } else {
            opts.size = utils.nextPowerOf2(opts.size);
          }
          this._heap = new ArrayBuffer(opts.size);
          this._heap8 = new Uint8Array(this._heap);
          this._buffer = Buffer3.from(this._heap);
          this._reset();
          this._knownTags = Object.assign({
            0: (val) => new Date(val),
            1: (val) => new Date(val * 1e3),
            2: (val) => utils.arrayBufferToBignumber(val),
            3: (val) => c3.NEG_ONE.minus(utils.arrayBufferToBignumber(val)),
            4: (v2) => {
              return c3.TEN.pow(v2[0]).times(v2[1]);
            },
            5: (v2) => {
              return c3.TWO.pow(v2[0]).times(v2[1]);
            },
            32: (val) => new URL2(val),
            35: (val) => new RegExp(val)
          }, opts.tags);
          this.parser = parser(window, {
            // eslint-disable-next-line no-console
            log: console.log.bind(console),
            pushInt: this.pushInt.bind(this),
            pushInt32: this.pushInt32.bind(this),
            pushInt32Neg: this.pushInt32Neg.bind(this),
            pushInt64: this.pushInt64.bind(this),
            pushInt64Neg: this.pushInt64Neg.bind(this),
            pushFloat: this.pushFloat.bind(this),
            pushFloatSingle: this.pushFloatSingle.bind(this),
            pushFloatDouble: this.pushFloatDouble.bind(this),
            pushTrue: this.pushTrue.bind(this),
            pushFalse: this.pushFalse.bind(this),
            pushUndefined: this.pushUndefined.bind(this),
            pushNull: this.pushNull.bind(this),
            pushInfinity: this.pushInfinity.bind(this),
            pushInfinityNeg: this.pushInfinityNeg.bind(this),
            pushNaN: this.pushNaN.bind(this),
            pushNaNNeg: this.pushNaNNeg.bind(this),
            pushArrayStart: this.pushArrayStart.bind(this),
            pushArrayStartFixed: this.pushArrayStartFixed.bind(this),
            pushArrayStartFixed32: this.pushArrayStartFixed32.bind(this),
            pushArrayStartFixed64: this.pushArrayStartFixed64.bind(this),
            pushObjectStart: this.pushObjectStart.bind(this),
            pushObjectStartFixed: this.pushObjectStartFixed.bind(this),
            pushObjectStartFixed32: this.pushObjectStartFixed32.bind(this),
            pushObjectStartFixed64: this.pushObjectStartFixed64.bind(this),
            pushByteString: this.pushByteString.bind(this),
            pushByteStringStart: this.pushByteStringStart.bind(this),
            pushUtf8String: this.pushUtf8String.bind(this),
            pushUtf8StringStart: this.pushUtf8StringStart.bind(this),
            pushSimpleUnassigned: this.pushSimpleUnassigned.bind(this),
            pushTagUnassigned: this.pushTagUnassigned.bind(this),
            pushTagStart: this.pushTagStart.bind(this),
            pushTagStart4: this.pushTagStart4.bind(this),
            pushTagStart8: this.pushTagStart8.bind(this),
            pushBreak: this.pushBreak.bind(this)
          }, this._heap);
        }
        get _depth() {
          return this._parents.length;
        }
        get _currentParent() {
          return this._parents[this._depth - 1];
        }
        get _ref() {
          return this._currentParent.ref;
        }
        // Finish the current parent
        _closeParent() {
          var p3 = this._parents.pop();
          if (p3.length > 0) {
            throw new Error(`Missing ${p3.length} elements`);
          }
          switch (p3.type) {
            case c3.PARENT.TAG:
              this._push(
                this.createTag(p3.ref[0], p3.ref[1])
              );
              break;
            case c3.PARENT.BYTE_STRING:
              this._push(this.createByteString(p3.ref, p3.length));
              break;
            case c3.PARENT.UTF8_STRING:
              this._push(this.createUtf8String(p3.ref, p3.length));
              break;
            case c3.PARENT.MAP:
              if (p3.values % 2 > 0) {
                throw new Error("Odd number of elements in the map");
              }
              this._push(this.createMap(p3.ref, p3.length));
              break;
            case c3.PARENT.OBJECT:
              if (p3.values % 2 > 0) {
                throw new Error("Odd number of elements in the map");
              }
              this._push(this.createObject(p3.ref, p3.length));
              break;
            case c3.PARENT.ARRAY:
              this._push(this.createArray(p3.ref, p3.length));
              break;
            default:
              break;
          }
          if (this._currentParent && this._currentParent.type === c3.PARENT.TAG) {
            this._dec();
          }
        }
        // Reduce the expected length of the current parent by one
        _dec() {
          const p3 = this._currentParent;
          if (p3.length < 0) {
            return;
          }
          p3.length--;
          if (p3.length === 0) {
            this._closeParent();
          }
        }
        // Push any value to the current parent
        _push(val, hasChildren) {
          const p3 = this._currentParent;
          p3.values++;
          switch (p3.type) {
            case c3.PARENT.ARRAY:
            case c3.PARENT.BYTE_STRING:
            case c3.PARENT.UTF8_STRING:
              if (p3.length > -1) {
                this._ref[this._ref.length - p3.length] = val;
              } else {
                this._ref.push(val);
              }
              this._dec();
              break;
            case c3.PARENT.OBJECT:
              if (p3.tmpKey != null) {
                this._ref[p3.tmpKey] = val;
                p3.tmpKey = null;
                this._dec();
              } else {
                p3.tmpKey = val;
                if (typeof p3.tmpKey !== "string") {
                  p3.type = c3.PARENT.MAP;
                  p3.ref = utils.buildMap(p3.ref);
                }
              }
              break;
            case c3.PARENT.MAP:
              if (p3.tmpKey != null) {
                this._ref.set(p3.tmpKey, val);
                p3.tmpKey = null;
                this._dec();
              } else {
                p3.tmpKey = val;
              }
              break;
            case c3.PARENT.TAG:
              this._ref.push(val);
              if (!hasChildren) {
                this._dec();
              }
              break;
            default:
              throw new Error("Unknown parent type");
          }
        }
        // Create a new parent in the parents list
        _createParent(obj, type, len) {
          this._parents[this._depth] = {
            type,
            length: len,
            ref: obj,
            values: 0,
            tmpKey: null
          };
        }
        // Reset all state back to the beginning, also used for initiatlization
        _reset() {
          this._res = [];
          this._parents = [{
            type: c3.PARENT.ARRAY,
            length: -1,
            ref: this._res,
            values: 0,
            tmpKey: null
          }];
        }
        // -- Interface to customize deoding behaviour
        createTag(tagNumber, value4) {
          const typ = this._knownTags[tagNumber];
          if (!typ) {
            return new Tagged(tagNumber, value4);
          }
          return typ(value4);
        }
        createMap(obj, len) {
          return obj;
        }
        createObject(obj, len) {
          return obj;
        }
        createArray(arr, len) {
          return arr;
        }
        createByteString(raw, len) {
          return Buffer3.concat(raw);
        }
        createByteStringFromHeap(start, end) {
          if (start === end) {
            return Buffer3.alloc(0);
          }
          return Buffer3.from(this._heap.slice(start, end));
        }
        createInt(val) {
          return val;
        }
        createInt32(f4, g3) {
          return utils.buildInt32(f4, g3);
        }
        createInt64(f1, f22, g1, g22) {
          return utils.buildInt64(f1, f22, g1, g22);
        }
        createFloat(val) {
          return val;
        }
        createFloatSingle(a, b3, c4, d2) {
          return ieee754.read([a, b3, c4, d2], 0, false, 23, 4);
        }
        createFloatDouble(a, b3, c4, d2, e3, f4, g3, h3) {
          return ieee754.read([a, b3, c4, d2, e3, f4, g3, h3], 0, false, 52, 8);
        }
        createInt32Neg(f4, g3) {
          return -1 - utils.buildInt32(f4, g3);
        }
        createInt64Neg(f1, f22, g1, g22) {
          const f4 = utils.buildInt32(f1, f22);
          const g3 = utils.buildInt32(g1, g22);
          if (f4 > c3.MAX_SAFE_HIGH) {
            return c3.NEG_ONE.minus(new Bignumber(f4).times(c3.SHIFT32).plus(g3));
          }
          return -1 - (f4 * c3.SHIFT32 + g3);
        }
        createTrue() {
          return true;
        }
        createFalse() {
          return false;
        }
        createNull() {
          return null;
        }
        createUndefined() {
          return void 0;
        }
        createInfinity() {
          return Infinity;
        }
        createInfinityNeg() {
          return -Infinity;
        }
        createNaN() {
          return NaN;
        }
        createNaNNeg() {
          return NaN;
        }
        createUtf8String(raw, len) {
          return raw.join("");
        }
        createUtf8StringFromHeap(start, end) {
          if (start === end) {
            return "";
          }
          return this._buffer.toString("utf8", start, end);
        }
        createSimpleUnassigned(val) {
          return new Simple(val);
        }
        // -- Interface for decoder.asm.js
        pushInt(val) {
          this._push(this.createInt(val));
        }
        pushInt32(f4, g3) {
          this._push(this.createInt32(f4, g3));
        }
        pushInt64(f1, f22, g1, g22) {
          this._push(this.createInt64(f1, f22, g1, g22));
        }
        pushFloat(val) {
          this._push(this.createFloat(val));
        }
        pushFloatSingle(a, b3, c4, d2) {
          this._push(this.createFloatSingle(a, b3, c4, d2));
        }
        pushFloatDouble(a, b3, c4, d2, e3, f4, g3, h3) {
          this._push(this.createFloatDouble(a, b3, c4, d2, e3, f4, g3, h3));
        }
        pushInt32Neg(f4, g3) {
          this._push(this.createInt32Neg(f4, g3));
        }
        pushInt64Neg(f1, f22, g1, g22) {
          this._push(this.createInt64Neg(f1, f22, g1, g22));
        }
        pushTrue() {
          this._push(this.createTrue());
        }
        pushFalse() {
          this._push(this.createFalse());
        }
        pushNull() {
          this._push(this.createNull());
        }
        pushUndefined() {
          this._push(this.createUndefined());
        }
        pushInfinity() {
          this._push(this.createInfinity());
        }
        pushInfinityNeg() {
          this._push(this.createInfinityNeg());
        }
        pushNaN() {
          this._push(this.createNaN());
        }
        pushNaNNeg() {
          this._push(this.createNaNNeg());
        }
        pushArrayStart() {
          this._createParent([], c3.PARENT.ARRAY, -1);
        }
        pushArrayStartFixed(len) {
          this._createArrayStartFixed(len);
        }
        pushArrayStartFixed32(len1, len2) {
          const len = utils.buildInt32(len1, len2);
          this._createArrayStartFixed(len);
        }
        pushArrayStartFixed64(len1, len2, len3, len4) {
          const len = utils.buildInt64(len1, len2, len3, len4);
          this._createArrayStartFixed(len);
        }
        pushObjectStart() {
          this._createObjectStartFixed(-1);
        }
        pushObjectStartFixed(len) {
          this._createObjectStartFixed(len);
        }
        pushObjectStartFixed32(len1, len2) {
          const len = utils.buildInt32(len1, len2);
          this._createObjectStartFixed(len);
        }
        pushObjectStartFixed64(len1, len2, len3, len4) {
          const len = utils.buildInt64(len1, len2, len3, len4);
          this._createObjectStartFixed(len);
        }
        pushByteStringStart() {
          this._parents[this._depth] = {
            type: c3.PARENT.BYTE_STRING,
            length: -1,
            ref: [],
            values: 0,
            tmpKey: null
          };
        }
        pushByteString(start, end) {
          this._push(this.createByteStringFromHeap(start, end));
        }
        pushUtf8StringStart() {
          this._parents[this._depth] = {
            type: c3.PARENT.UTF8_STRING,
            length: -1,
            ref: [],
            values: 0,
            tmpKey: null
          };
        }
        pushUtf8String(start, end) {
          this._push(this.createUtf8StringFromHeap(start, end));
        }
        pushSimpleUnassigned(val) {
          this._push(this.createSimpleUnassigned(val));
        }
        pushTagStart(tag) {
          this._parents[this._depth] = {
            type: c3.PARENT.TAG,
            length: 1,
            ref: [tag]
          };
        }
        pushTagStart4(f4, g3) {
          this.pushTagStart(utils.buildInt32(f4, g3));
        }
        pushTagStart8(f1, f22, g1, g22) {
          this.pushTagStart(utils.buildInt64(f1, f22, g1, g22));
        }
        pushTagUnassigned(tagNumber) {
          this._push(this.createTag(tagNumber));
        }
        pushBreak() {
          if (this._currentParent.length > -1) {
            throw new Error("Unexpected break");
          }
          this._closeParent();
        }
        _createObjectStartFixed(len) {
          if (len === 0) {
            this._push(this.createObject({}));
            return;
          }
          this._createParent({}, c3.PARENT.OBJECT, len);
        }
        _createArrayStartFixed(len) {
          if (len === 0) {
            this._push(this.createArray([]));
            return;
          }
          this._createParent(new Array(len), c3.PARENT.ARRAY, len);
        }
        _decode(input) {
          if (input.byteLength === 0) {
            throw new Error("Input too short");
          }
          this._reset();
          this._heap8.set(input);
          const code = this.parser.parse(input.byteLength);
          if (this._depth > 1) {
            while (this._currentParent.length === 0) {
              this._closeParent();
            }
            if (this._depth > 1) {
              throw new Error("Undeterminated nesting");
            }
          }
          if (code > 0) {
            throw new Error("Failed to parse");
          }
          if (this._res.length === 0) {
            throw new Error("No valid result");
          }
        }
        // -- Public Interface
        decodeFirst(input) {
          this._decode(input);
          return this._res[0];
        }
        decodeAll(input) {
          this._decode(input);
          return this._res;
        }
        /**
         * Decode the first cbor object.
         *
         * @param {Buffer|string} input
         * @param {string} [enc='hex'] - Encoding used if a string is passed.
         * @returns {*}
         */
        static decode(input, enc) {
          if (typeof input === "string") {
            input = Buffer3.from(input, enc || "hex");
          }
          const dec = new _Decoder({ size: input.length });
          return dec.decodeFirst(input);
        }
        /**
         * Decode all cbor objects.
         *
         * @param {Buffer|string} input
         * @param {string} [enc='hex'] - Encoding used if a string is passed.
         * @returns {Array<*>}
         */
        static decodeAll(input, enc) {
          if (typeof input === "string") {
            input = Buffer3.from(input, enc || "hex");
          }
          const dec = new _Decoder({ size: input.length });
          return dec.decodeAll(input);
        }
      };
      Decoder.decodeFirst = Decoder.decode;
      module.exports = Decoder;
    }
  });

  // node_modules/borc/src/diagnose.js
  var require_diagnose = __commonJS({
    "node_modules/borc/src/diagnose.js"(exports, module) {
      "use strict";
      var { Buffer: Buffer3 } = require_buffer2();
      var Decoder = require_decoder();
      var utils = require_utils();
      var Diagnose = class _Diagnose extends Decoder {
        createTag(tagNumber, value4) {
          return `${tagNumber}(${value4})`;
        }
        createInt(val) {
          return super.createInt(val).toString();
        }
        createInt32(f4, g3) {
          return super.createInt32(f4, g3).toString();
        }
        createInt64(f1, f22, g1, g22) {
          return super.createInt64(f1, f22, g1, g22).toString();
        }
        createInt32Neg(f4, g3) {
          return super.createInt32Neg(f4, g3).toString();
        }
        createInt64Neg(f1, f22, g1, g22) {
          return super.createInt64Neg(f1, f22, g1, g22).toString();
        }
        createTrue() {
          return "true";
        }
        createFalse() {
          return "false";
        }
        createFloat(val) {
          const fl = super.createFloat(val);
          if (utils.isNegativeZero(val)) {
            return "-0_1";
          }
          return `${fl}_1`;
        }
        createFloatSingle(a, b3, c3, d2) {
          const fl = super.createFloatSingle(a, b3, c3, d2);
          return `${fl}_2`;
        }
        createFloatDouble(a, b3, c3, d2, e3, f4, g3, h3) {
          const fl = super.createFloatDouble(a, b3, c3, d2, e3, f4, g3, h3);
          return `${fl}_3`;
        }
        createByteString(raw, len) {
          const val = raw.join(", ");
          if (len === -1) {
            return `(_ ${val})`;
          }
          return `h'${val}`;
        }
        createByteStringFromHeap(start, end) {
          const val = Buffer3.from(
            super.createByteStringFromHeap(start, end)
          ).toString("hex");
          return `h'${val}'`;
        }
        createInfinity() {
          return "Infinity_1";
        }
        createInfinityNeg() {
          return "-Infinity_1";
        }
        createNaN() {
          return "NaN_1";
        }
        createNaNNeg() {
          return "-NaN_1";
        }
        createNull() {
          return "null";
        }
        createUndefined() {
          return "undefined";
        }
        createSimpleUnassigned(val) {
          return `simple(${val})`;
        }
        createArray(arr, len) {
          const val = super.createArray(arr, len);
          if (len === -1) {
            return `[_ ${val.join(", ")}]`;
          }
          return `[${val.join(", ")}]`;
        }
        createMap(map, len) {
          const val = super.createMap(map);
          const list = Array.from(val.keys()).reduce(collectObject(val), "");
          if (len === -1) {
            return `{_ ${list}}`;
          }
          return `{${list}}`;
        }
        createObject(obj, len) {
          const val = super.createObject(obj);
          const map = Object.keys(val).reduce(collectObject(val), "");
          if (len === -1) {
            return `{_ ${map}}`;
          }
          return `{${map}}`;
        }
        createUtf8String(raw, len) {
          const val = raw.join(", ");
          if (len === -1) {
            return `(_ ${val})`;
          }
          return `"${val}"`;
        }
        createUtf8StringFromHeap(start, end) {
          const val = Buffer3.from(
            super.createUtf8StringFromHeap(start, end)
          ).toString("utf8");
          return `"${val}"`;
        }
        static diagnose(input, enc) {
          if (typeof input === "string") {
            input = Buffer3.from(input, enc || "hex");
          }
          const dec = new _Diagnose();
          return dec.decodeFirst(input);
        }
      };
      module.exports = Diagnose;
      function collectObject(val) {
        return (acc, key) => {
          if (acc) {
            return `${acc}, ${key}: ${val[key]}`;
          }
          return `${key}: ${val[key]}`;
        };
      }
    }
  });

  // node_modules/borc/src/encoder.js
  var require_encoder = __commonJS({
    "node_modules/borc/src/encoder.js"(exports, module) {
      "use strict";
      var { Buffer: Buffer3 } = require_buffer2();
      var { URL: URL2 } = require_iso_url();
      var Bignumber = require_bignumber().BigNumber;
      var utils = require_utils();
      var constants = require_constants();
      var MT = constants.MT;
      var NUMBYTES = constants.NUMBYTES;
      var SHIFT32 = constants.SHIFT32;
      var SYMS = constants.SYMS;
      var TAG = constants.TAG;
      var HALF = constants.MT.SIMPLE_FLOAT << 5 | constants.NUMBYTES.TWO;
      var FLOAT = constants.MT.SIMPLE_FLOAT << 5 | constants.NUMBYTES.FOUR;
      var DOUBLE = constants.MT.SIMPLE_FLOAT << 5 | constants.NUMBYTES.EIGHT;
      var TRUE = constants.MT.SIMPLE_FLOAT << 5 | constants.SIMPLE.TRUE;
      var FALSE = constants.MT.SIMPLE_FLOAT << 5 | constants.SIMPLE.FALSE;
      var UNDEFINED = constants.MT.SIMPLE_FLOAT << 5 | constants.SIMPLE.UNDEFINED;
      var NULL = constants.MT.SIMPLE_FLOAT << 5 | constants.SIMPLE.NULL;
      var MAXINT_BN = new Bignumber("0x20000000000000");
      var BUF_NAN = Buffer3.from("f97e00", "hex");
      var BUF_INF_NEG = Buffer3.from("f9fc00", "hex");
      var BUF_INF_POS = Buffer3.from("f97c00", "hex");
      function toType(obj) {
        return {}.toString.call(obj).slice(8, -1);
      }
      var Encoder = class _Encoder {
        /**
         * @param {Object} [options={}]
         * @param {function(Buffer)} options.stream
         */
        constructor(options) {
          options = options || {};
          this.streaming = typeof options.stream === "function";
          this.onData = options.stream;
          this.semanticTypes = [
            [URL2, this._pushUrl],
            [Bignumber, this._pushBigNumber]
          ];
          const addTypes = options.genTypes || [];
          const len = addTypes.length;
          for (let i = 0; i < len; i++) {
            this.addSemanticType(
              addTypes[i][0],
              addTypes[i][1]
            );
          }
          this._reset();
        }
        addSemanticType(type, fun) {
          const len = this.semanticTypes.length;
          for (let i = 0; i < len; i++) {
            const typ = this.semanticTypes[i][0];
            if (typ === type) {
              const old = this.semanticTypes[i][1];
              this.semanticTypes[i][1] = fun;
              return old;
            }
          }
          this.semanticTypes.push([type, fun]);
          return null;
        }
        push(val) {
          if (!val) {
            return true;
          }
          this.result[this.offset] = val;
          this.resultMethod[this.offset] = 0;
          this.resultLength[this.offset] = val.length;
          this.offset++;
          if (this.streaming) {
            this.onData(this.finalize());
          }
          return true;
        }
        pushWrite(val, method, len) {
          this.result[this.offset] = val;
          this.resultMethod[this.offset] = method;
          this.resultLength[this.offset] = len;
          this.offset++;
          if (this.streaming) {
            this.onData(this.finalize());
          }
          return true;
        }
        _pushUInt8(val) {
          return this.pushWrite(val, 1, 1);
        }
        _pushUInt16BE(val) {
          return this.pushWrite(val, 2, 2);
        }
        _pushUInt32BE(val) {
          return this.pushWrite(val, 3, 4);
        }
        _pushDoubleBE(val) {
          return this.pushWrite(val, 4, 8);
        }
        _pushNaN() {
          return this.push(BUF_NAN);
        }
        _pushInfinity(obj) {
          const half = obj < 0 ? BUF_INF_NEG : BUF_INF_POS;
          return this.push(half);
        }
        _pushFloat(obj) {
          const b22 = Buffer3.allocUnsafe(2);
          if (utils.writeHalf(b22, obj)) {
            if (utils.parseHalf(b22) === obj) {
              return this._pushUInt8(HALF) && this.push(b22);
            }
          }
          const b4 = Buffer3.allocUnsafe(4);
          b4.writeFloatBE(obj, 0);
          if (b4.readFloatBE(0) === obj) {
            return this._pushUInt8(FLOAT) && this.push(b4);
          }
          return this._pushUInt8(DOUBLE) && this._pushDoubleBE(obj);
        }
        _pushInt(obj, mt, orig) {
          const m3 = mt << 5;
          if (obj < 24) {
            return this._pushUInt8(m3 | obj);
          }
          if (obj <= 255) {
            return this._pushUInt8(m3 | NUMBYTES.ONE) && this._pushUInt8(obj);
          }
          if (obj <= 65535) {
            return this._pushUInt8(m3 | NUMBYTES.TWO) && this._pushUInt16BE(obj);
          }
          if (obj <= 4294967295) {
            return this._pushUInt8(m3 | NUMBYTES.FOUR) && this._pushUInt32BE(obj);
          }
          if (obj <= Number.MAX_SAFE_INTEGER) {
            return this._pushUInt8(m3 | NUMBYTES.EIGHT) && this._pushUInt32BE(Math.floor(obj / SHIFT32)) && this._pushUInt32BE(obj % SHIFT32);
          }
          if (mt === MT.NEG_INT) {
            return this._pushFloat(orig);
          }
          return this._pushFloat(obj);
        }
        _pushIntNum(obj) {
          if (obj < 0) {
            return this._pushInt(-obj - 1, MT.NEG_INT, obj);
          } else {
            return this._pushInt(obj, MT.POS_INT);
          }
        }
        _pushNumber(obj) {
          switch (false) {
            case obj === obj:
              return this._pushNaN(obj);
            case isFinite(obj):
              return this._pushInfinity(obj);
            case obj % 1 !== 0:
              return this._pushIntNum(obj);
            default:
              return this._pushFloat(obj);
          }
        }
        _pushString(obj) {
          const len = Buffer3.byteLength(obj, "utf8");
          return this._pushInt(len, MT.UTF8_STRING) && this.pushWrite(obj, 5, len);
        }
        _pushBoolean(obj) {
          return this._pushUInt8(obj ? TRUE : FALSE);
        }
        _pushUndefined(obj) {
          return this._pushUInt8(UNDEFINED);
        }
        _pushArray(gen, obj) {
          const len = obj.length;
          if (!gen._pushInt(len, MT.ARRAY)) {
            return false;
          }
          for (let j2 = 0; j2 < len; j2++) {
            if (!gen.pushAny(obj[j2])) {
              return false;
            }
          }
          return true;
        }
        _pushTag(tag) {
          return this._pushInt(tag, MT.TAG);
        }
        _pushDate(gen, obj) {
          return gen._pushTag(TAG.DATE_EPOCH) && gen.pushAny(Math.round(obj / 1e3));
        }
        _pushBuffer(gen, obj) {
          return gen._pushInt(obj.length, MT.BYTE_STRING) && gen.push(obj);
        }
        _pushNoFilter(gen, obj) {
          return gen._pushBuffer(gen, obj.slice());
        }
        _pushRegexp(gen, obj) {
          return gen._pushTag(TAG.REGEXP) && gen.pushAny(obj.source);
        }
        _pushSet(gen, obj) {
          if (!gen._pushInt(obj.size, MT.ARRAY)) {
            return false;
          }
          for (const x5 of obj) {
            if (!gen.pushAny(x5)) {
              return false;
            }
          }
          return true;
        }
        _pushUrl(gen, obj) {
          return gen._pushTag(TAG.URI) && gen.pushAny(obj.format());
        }
        _pushBigint(obj) {
          let tag = TAG.POS_BIGINT;
          if (obj.isNegative()) {
            obj = obj.negated().minus(1);
            tag = TAG.NEG_BIGINT;
          }
          let str = obj.toString(16);
          if (str.length % 2) {
            str = "0" + str;
          }
          const buf = Buffer3.from(str, "hex");
          return this._pushTag(tag) && this._pushBuffer(this, buf);
        }
        _pushBigNumber(gen, obj) {
          if (obj.isNaN()) {
            return gen._pushNaN();
          }
          if (!obj.isFinite()) {
            return gen._pushInfinity(obj.isNegative() ? -Infinity : Infinity);
          }
          if (obj.isInteger()) {
            return gen._pushBigint(obj);
          }
          if (!(gen._pushTag(TAG.DECIMAL_FRAC) && gen._pushInt(2, MT.ARRAY))) {
            return false;
          }
          const dec = obj.decimalPlaces();
          const slide = obj.multipliedBy(new Bignumber(10).pow(dec));
          if (!gen._pushIntNum(-dec)) {
            return false;
          }
          if (slide.abs().isLessThan(MAXINT_BN)) {
            return gen._pushIntNum(slide.toNumber());
          } else {
            return gen._pushBigint(slide);
          }
        }
        _pushMap(gen, obj) {
          if (!gen._pushInt(obj.size, MT.MAP)) {
            return false;
          }
          return this._pushRawMap(
            obj.size,
            Array.from(obj)
          );
        }
        _pushObject(obj) {
          if (!obj) {
            return this._pushUInt8(NULL);
          }
          var len = this.semanticTypes.length;
          for (var i = 0; i < len; i++) {
            if (obj instanceof this.semanticTypes[i][0]) {
              return this.semanticTypes[i][1].call(obj, this, obj);
            }
          }
          var f4 = obj.encodeCBOR;
          if (typeof f4 === "function") {
            return f4.call(obj, this);
          }
          var keys = Object.keys(obj);
          var keyLength = keys.length;
          if (!this._pushInt(keyLength, MT.MAP)) {
            return false;
          }
          return this._pushRawMap(
            keyLength,
            keys.map((k2) => [k2, obj[k2]])
          );
        }
        _pushRawMap(len, map) {
          map = map.map(function(a) {
            a[0] = _Encoder.encode(a[0]);
            return a;
          }).sort(utils.keySorter);
          for (var j2 = 0; j2 < len; j2++) {
            if (!this.push(map[j2][0])) {
              return false;
            }
            if (!this.pushAny(map[j2][1])) {
              return false;
            }
          }
          return true;
        }
        /**
         * Alias for `.pushAny`
         *
         * @param {*} obj
         * @returns {boolean} true on success
         */
        write(obj) {
          return this.pushAny(obj);
        }
        /**
         * Push any supported type onto the encoded stream
         *
         * @param {any} obj
         * @returns {boolean} true on success
         */
        pushAny(obj) {
          var typ = toType(obj);
          switch (typ) {
            case "Number":
              return this._pushNumber(obj);
            case "String":
              return this._pushString(obj);
            case "Boolean":
              return this._pushBoolean(obj);
            case "Object":
              return this._pushObject(obj);
            case "Array":
              return this._pushArray(this, obj);
            case "Uint8Array":
              return this._pushBuffer(this, Buffer3.isBuffer(obj) ? obj : Buffer3.from(obj));
            case "Null":
              return this._pushUInt8(NULL);
            case "Undefined":
              return this._pushUndefined(obj);
            case "Map":
              return this._pushMap(this, obj);
            case "Set":
              return this._pushSet(this, obj);
            case "URL":
              return this._pushUrl(this, obj);
            case "BigNumber":
              return this._pushBigNumber(this, obj);
            case "Date":
              return this._pushDate(this, obj);
            case "RegExp":
              return this._pushRegexp(this, obj);
            case "Symbol":
              switch (obj) {
                case SYMS.NULL:
                  return this._pushObject(null);
                case SYMS.UNDEFINED:
                  return this._pushUndefined(void 0);
                default:
                  throw new Error("Unknown symbol: " + obj.toString());
              }
            default:
              throw new Error("Unknown type: " + typeof obj + ", " + (obj ? obj.toString() : ""));
          }
        }
        finalize() {
          if (this.offset === 0) {
            return null;
          }
          var result = this.result;
          var resultLength = this.resultLength;
          var resultMethod = this.resultMethod;
          var offset = this.offset;
          var size = 0;
          var i = 0;
          for (; i < offset; i++) {
            size += resultLength[i];
          }
          var res = Buffer3.allocUnsafe(size);
          var index = 0;
          var length = 0;
          for (i = 0; i < offset; i++) {
            length = resultLength[i];
            switch (resultMethod[i]) {
              case 0:
                result[i].copy(res, index);
                break;
              case 1:
                res.writeUInt8(result[i], index, true);
                break;
              case 2:
                res.writeUInt16BE(result[i], index, true);
                break;
              case 3:
                res.writeUInt32BE(result[i], index, true);
                break;
              case 4:
                res.writeDoubleBE(result[i], index, true);
                break;
              case 5:
                res.write(result[i], index, length, "utf8");
                break;
              default:
                throw new Error("unkown method");
            }
            index += length;
          }
          var tmp = res;
          this._reset();
          return tmp;
        }
        _reset() {
          this.result = [];
          this.resultMethod = [];
          this.resultLength = [];
          this.offset = 0;
        }
        /**
         * Encode the given value
         * @param {*} o
         * @returns {Buffer}
         */
        static encode(o) {
          const enc = new _Encoder();
          const ret = enc.pushAny(o);
          if (!ret) {
            throw new Error("Failed to encode input");
          }
          return enc.finalize();
        }
      };
      module.exports = Encoder;
    }
  });

  // node_modules/borc/src/index.js
  var require_src = __commonJS({
    "node_modules/borc/src/index.js"(exports) {
      "use strict";
      exports.Diagnose = require_diagnose();
      exports.Decoder = require_decoder();
      exports.Encoder = require_encoder();
      exports.Simple = require_simple();
      exports.Tagged = require_tagged();
      exports.decodeAll = exports.Decoder.decodeAll;
      exports.decodeFirst = exports.Decoder.decodeFirst;
      exports.diagnose = exports.Diagnose.diagnose;
      exports.encode = exports.Encoder.encode;
      exports.decode = exports.Decoder.decode;
      exports.leveldb = {
        decode: exports.Decoder.decodeAll,
        encode: exports.Encoder.encode,
        buffer: true,
        name: "cbor"
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/request_id.js
  function hash(data) {
    return uint8ToBuf(sha256.create().update(new Uint8Array(data)).digest());
  }
  function hashValue(value4) {
    if (value4 instanceof import_borc.default.Tagged) {
      return hashValue(value4.value);
    } else if (typeof value4 === "string") {
      return hashString(value4);
    } else if (typeof value4 === "number") {
      return hash(lebEncode(value4));
    } else if (value4 instanceof ArrayBuffer || ArrayBuffer.isView(value4)) {
      return hash(value4);
    } else if (Array.isArray(value4)) {
      const vals = value4.map(hashValue);
      return hash(concat(...vals));
    } else if (value4 && typeof value4 === "object" && value4._isPrincipal) {
      return hash(value4.toUint8Array());
    } else if (typeof value4 === "object" && value4 !== null && typeof value4.toHash === "function") {
      return hashValue(value4.toHash());
    } else if (typeof value4 === "object") {
      return hashOfMap(value4);
    } else if (typeof value4 === "bigint") {
      return hash(lebEncode(value4));
    }
    throw Object.assign(new Error(`Attempt to hash a value of unsupported type: ${value4}`), {
      // include so logs/callers can understand the confusing value.
      // (when stringified in error message, prototype info is lost)
      value: value4
    });
  }
  function requestIdOf(request2) {
    return hashOfMap(request2);
  }
  function hashOfMap(map) {
    const hashed = Object.entries(map).filter(([, value4]) => value4 !== void 0).map(([key, value4]) => {
      const hashedKey = hashString(key);
      const hashedValue = hashValue(value4);
      return [hashedKey, hashedValue];
    });
    const traversed = hashed;
    const sorted = traversed.sort(([k1], [k2]) => {
      return compare(k1, k2);
    });
    const concatenated = concat(...sorted.map((x5) => concat(...x5)));
    const result = hash(concatenated);
    return result;
  }
  var import_borc, hashString;
  var init_request_id = __esm({
    "node_modules/@dfinity/agent/lib/esm/request_id.js"() {
      init_esm2();
      import_borc = __toESM(require_src());
      init_sha256();
      init_buffer();
      hashString = (value4) => {
        const encoded = new TextEncoder().encode(value4);
        return hash(encoded);
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/auth.js
  var __rest, domainSeparator, SignIdentity, AnonymousIdentity;
  var init_auth = __esm({
    "node_modules/@dfinity/agent/lib/esm/auth.js"() {
      init_esm();
      init_request_id();
      init_buffer();
      __rest = function(s2, e3) {
        var t2 = {};
        for (var p3 in s2)
          if (Object.prototype.hasOwnProperty.call(s2, p3) && e3.indexOf(p3) < 0)
            t2[p3] = s2[p3];
        if (s2 != null && typeof Object.getOwnPropertySymbols === "function")
          for (var i = 0, p3 = Object.getOwnPropertySymbols(s2); i < p3.length; i++) {
            if (e3.indexOf(p3[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s2, p3[i]))
              t2[p3[i]] = s2[p3[i]];
          }
        return t2;
      };
      domainSeparator = new TextEncoder().encode("\nic-request");
      SignIdentity = class {
        /**
         * Get the principal represented by this identity. Normally should be a
         * `Principal.selfAuthenticating()`.
         */
        getPrincipal() {
          if (!this._principal) {
            this._principal = Principal.selfAuthenticating(new Uint8Array(this.getPublicKey().toDer()));
          }
          return this._principal;
        }
        /**
         * Transform a request into a signed version of the request. This is done last
         * after the transforms on the body of a request. The returned object can be
         * anything, but must be serializable to CBOR.
         * @param request - internet computer request to transform
         */
        async transformRequest(request2) {
          const { body } = request2, fields = __rest(request2, ["body"]);
          const requestId = requestIdOf(body);
          return Object.assign(Object.assign({}, fields), { body: {
            content: body,
            sender_pubkey: this.getPublicKey().toDer(),
            sender_sig: await this.sign(concat(domainSeparator, requestId))
          } });
        }
      };
      AnonymousIdentity = class {
        getPrincipal() {
          return Principal.anonymous();
        }
        async transformRequest(request2) {
          return Object.assign(Object.assign({}, request2), { body: { content: request2.body } });
        }
      };
    }
  });

  // node_modules/simple-cbor/src/value.js
  var require_value = __commonJS({
    "node_modules/simple-cbor/src/value.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var MAX_U64_NUMBER = 9007199254740992;
      function _concat(a, ...args) {
        const newBuffer = new Uint8Array(a.byteLength + args.reduce((acc, b3) => acc + b3.byteLength, 0));
        newBuffer.set(new Uint8Array(a), 0);
        let i = a.byteLength;
        for (const b3 of args) {
          newBuffer.set(new Uint8Array(b3), i);
          i += b3.byteLength;
        }
        return newBuffer.buffer;
      }
      function _serializeValue(major, minor, value4) {
        value4 = value4.replace(/[^0-9a-fA-F]/g, "");
        const length = 2 ** (minor - 24);
        value4 = value4.slice(-length * 2).padStart(length * 2, "0");
        const bytes2 = [(major << 5) + minor].concat(value4.match(/../g).map((byte) => parseInt(byte, 16)));
        return new Uint8Array(bytes2).buffer;
      }
      function _serializeNumber(major, value4) {
        if (value4 < 24) {
          return new Uint8Array([(major << 5) + value4]).buffer;
        } else {
          const minor = value4 <= 255 ? 24 : value4 <= 65535 ? 25 : value4 <= 4294967295 ? 26 : 27;
          return _serializeValue(major, minor, value4.toString(16));
        }
      }
      function _serializeString(str) {
        const utf8 = [];
        for (let i = 0; i < str.length; i++) {
          let charcode = str.charCodeAt(i);
          if (charcode < 128) {
            utf8.push(charcode);
          } else if (charcode < 2048) {
            utf8.push(192 | charcode >> 6, 128 | charcode & 63);
          } else if (charcode < 55296 || charcode >= 57344) {
            utf8.push(224 | charcode >> 12, 128 | charcode >> 6 & 63, 128 | charcode & 63);
          } else {
            i++;
            charcode = (charcode & 1023) << 10 | str.charCodeAt(i) & 1023;
            utf8.push(240 | charcode >> 18, 128 | charcode >> 12 & 63, 128 | charcode >> 6 & 63, 128 | charcode & 63);
          }
        }
        return _concat(new Uint8Array(_serializeNumber(3, str.length)), new Uint8Array(utf8));
      }
      function tagged(tag, value4) {
        if (tag == 14277111) {
          return _concat(new Uint8Array([217, 217, 247]), value4);
        }
        if (tag < 24) {
          return _concat(new Uint8Array([(6 << 5) + tag]), value4);
        } else {
          const minor = tag <= 255 ? 24 : tag <= 65535 ? 25 : tag <= 4294967295 ? 26 : 27;
          const length = 2 ** (minor - 24);
          const value5 = tag.toString(16).slice(-length * 2).padStart(length * 2, "0");
          const bytes2 = [(6 << 5) + minor].concat(value5.match(/../g).map((byte) => parseInt(byte, 16)));
          return new Uint8Array(bytes2).buffer;
        }
      }
      exports.tagged = tagged;
      function raw(bytes2) {
        return new Uint8Array(bytes2).buffer;
      }
      exports.raw = raw;
      function uSmall(n2) {
        if (isNaN(n2)) {
          throw new RangeError("Invalid number.");
        }
        n2 = Math.min(Math.max(0, n2), 23);
        const bytes2 = [(0 << 5) + n2];
        return new Uint8Array(bytes2).buffer;
      }
      exports.uSmall = uSmall;
      function u8(u82, radix) {
        u82 = parseInt("" + u82, radix);
        if (isNaN(u82)) {
          throw new RangeError("Invalid number.");
        }
        u82 = Math.min(Math.max(0, u82), 255);
        u82 = u82.toString(16);
        return _serializeValue(0, 24, u82);
      }
      exports.u8 = u8;
      function u16(u162, radix) {
        u162 = parseInt("" + u162, radix);
        if (isNaN(u162)) {
          throw new RangeError("Invalid number.");
        }
        u162 = Math.min(Math.max(0, u162), 65535);
        u162 = u162.toString(16);
        return _serializeValue(0, 25, u162);
      }
      exports.u16 = u16;
      function u32(u322, radix) {
        u322 = parseInt("" + u322, radix);
        if (isNaN(u322)) {
          throw new RangeError("Invalid number.");
        }
        u322 = Math.min(Math.max(0, u322), 4294967295);
        u322 = u322.toString(16);
        return _serializeValue(0, 26, u322);
      }
      exports.u32 = u32;
      function u642(u643, radix) {
        if (typeof u643 == "string" && radix == 16) {
          if (u643.match(/[^0-9a-fA-F]/)) {
            throw new RangeError("Invalid number.");
          }
          return _serializeValue(0, 27, u643);
        }
        u643 = parseInt("" + u643, radix);
        if (isNaN(u643)) {
          throw new RangeError("Invalid number.");
        }
        u643 = Math.min(Math.max(0, u643), MAX_U64_NUMBER);
        u643 = u643.toString(16);
        return _serializeValue(0, 27, u643);
      }
      exports.u64 = u642;
      function iSmall(n2) {
        if (isNaN(n2)) {
          throw new RangeError("Invalid number.");
        }
        if (n2 === 0) {
          return uSmall(0);
        }
        n2 = Math.min(Math.max(0, -n2), 24) - 1;
        const bytes2 = [(1 << 5) + n2];
        return new Uint8Array(bytes2).buffer;
      }
      exports.iSmall = iSmall;
      function i8(i82, radix) {
        i82 = parseInt("" + i82, radix);
        if (isNaN(i82)) {
          throw new RangeError("Invalid number.");
        }
        i82 = Math.min(Math.max(0, -i82 - 1), 255);
        i82 = i82.toString(16);
        return _serializeValue(1, 24, i82);
      }
      exports.i8 = i8;
      function i16(i162, radix) {
        i162 = parseInt("" + i162, radix);
        if (isNaN(i162)) {
          throw new RangeError("Invalid number.");
        }
        i162 = Math.min(Math.max(0, -i162 - 1), 65535);
        i162 = i162.toString(16);
        return _serializeValue(1, 25, i162);
      }
      exports.i16 = i16;
      function i32(i322, radix) {
        i322 = parseInt("" + i322, radix);
        if (isNaN(i322)) {
          throw new RangeError("Invalid number.");
        }
        i322 = Math.min(Math.max(0, -i322 - 1), 4294967295);
        i322 = i322.toString(16);
        return _serializeValue(1, 26, i322);
      }
      exports.i32 = i32;
      function i64(i642, radix) {
        if (typeof i642 == "string" && radix == 16) {
          if (i642.startsWith("-")) {
            i642 = i642.slice(1);
          } else {
            i642 = "0";
          }
          if (i642.match(/[^0-9a-fA-F]/) || i642.length > 16) {
            throw new RangeError("Invalid number.");
          }
          let done = false;
          let newI64 = i642.split("").reduceRight((acc, x5) => {
            if (done) {
              return x5 + acc;
            }
            let n2 = parseInt(x5, 16) - 1;
            if (n2 >= 0) {
              done = true;
              return n2.toString(16) + acc;
            } else {
              return "f" + acc;
            }
          }, "");
          if (!done) {
            return u642(0);
          }
          return _serializeValue(1, 27, newI64);
        }
        i642 = parseInt("" + i642, radix);
        if (isNaN(i642)) {
          throw new RangeError("Invalid number.");
        }
        i642 = Math.min(Math.max(0, -i642 - 1), 9007199254740992);
        i642 = i642.toString(16);
        return _serializeValue(1, 27, i642);
      }
      exports.i64 = i64;
      function number(n2) {
        if (n2 >= 0) {
          if (n2 < 24) {
            return uSmall(n2);
          } else if (n2 <= 255) {
            return u8(n2);
          } else if (n2 <= 65535) {
            return u16(n2);
          } else if (n2 <= 4294967295) {
            return u32(n2);
          } else {
            return u642(n2);
          }
        } else {
          if (n2 >= -24) {
            return iSmall(n2);
          } else if (n2 >= -255) {
            return i8(n2);
          } else if (n2 >= -65535) {
            return i16(n2);
          } else if (n2 >= -4294967295) {
            return i32(n2);
          } else {
            return i64(n2);
          }
        }
      }
      exports.number = number;
      function bytes(bytes2) {
        return _concat(_serializeNumber(2, bytes2.byteLength), bytes2);
      }
      exports.bytes = bytes;
      function string(str) {
        return _serializeString(str);
      }
      exports.string = string;
      function array(items) {
        return _concat(_serializeNumber(4, items.length), ...items);
      }
      exports.array = array;
      function map(items, stable = false) {
        if (!(items instanceof Map)) {
          items = new Map(Object.entries(items));
        }
        let entries = Array.from(items.entries());
        if (stable) {
          entries = entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
        }
        return _concat(_serializeNumber(5, items.size), ...entries.map(([k2, v2]) => _concat(_serializeString(k2), v2)));
      }
      exports.map = map;
      function singleFloat(f4) {
        const single = new Float32Array([f4]);
        return _concat(new Uint8Array([(7 << 5) + 26]), new Uint8Array(single.buffer));
      }
      exports.singleFloat = singleFloat;
      function doubleFloat(f4) {
        const single = new Float64Array([f4]);
        return _concat(new Uint8Array([(7 << 5) + 27]), new Uint8Array(single.buffer));
      }
      exports.doubleFloat = doubleFloat;
      function bool(v2) {
        return v2 ? true_() : false_();
      }
      exports.bool = bool;
      function true_() {
        return raw(new Uint8Array([(7 << 5) + 21]));
      }
      exports.true_ = true_;
      function false_() {
        return raw(new Uint8Array([(7 << 5) + 20]));
      }
      exports.false_ = false_;
      function null_() {
        return raw(new Uint8Array([(7 << 5) + 22]));
      }
      exports.null_ = null_;
      function undefined_() {
        return raw(new Uint8Array([(7 << 5) + 23]));
      }
      exports.undefined_ = undefined_;
    }
  });

  // node_modules/simple-cbor/src/serializer.js
  var require_serializer = __commonJS({
    "node_modules/simple-cbor/src/serializer.js"(exports) {
      "use strict";
      var __importStar = exports && exports.__importStar || function(mod2) {
        if (mod2 && mod2.__esModule)
          return mod2;
        var result = {};
        if (mod2 != null) {
          for (var k2 in mod2)
            if (Object.hasOwnProperty.call(mod2, k2))
              result[k2] = mod2[k2];
        }
        result["default"] = mod2;
        return result;
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      var cbor4 = __importStar(require_value());
      var BufferClasses = [
        ArrayBuffer,
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float32Array,
        Float64Array
      ];
      var JsonDefaultCborEncoder = class {
        // @param _serializer The CBOR Serializer to use.
        // @param _stable Whether or not keys from objects should be sorted (stable). This is
        //     particularly useful when testing encodings between JSON objects.
        constructor(_serializer, _stable = false) {
          this._serializer = _serializer;
          this._stable = _stable;
          this.name = "jsonDefault";
          this.priority = -100;
        }
        match(value4) {
          return ["undefined", "boolean", "number", "string", "object"].indexOf(typeof value4) != -1;
        }
        encode(value4) {
          switch (typeof value4) {
            case "undefined":
              return cbor4.undefined_();
            case "boolean":
              return cbor4.bool(value4);
            case "number":
              if (Math.floor(value4) === value4) {
                return cbor4.number(value4);
              } else {
                return cbor4.doubleFloat(value4);
              }
            case "string":
              return cbor4.string(value4);
            case "object":
              if (value4 === null) {
                return cbor4.null_();
              } else if (Array.isArray(value4)) {
                return cbor4.array(value4.map((x5) => this._serializer.serializeValue(x5)));
              } else if (BufferClasses.find((x5) => value4 instanceof x5)) {
                return cbor4.bytes(value4.buffer);
              } else if (Object.getOwnPropertyNames(value4).indexOf("toJSON") !== -1) {
                return this.encode(value4.toJSON());
              } else if (value4 instanceof Map) {
                const m3 = /* @__PURE__ */ new Map();
                for (const [key, item] of value4.entries()) {
                  m3.set(key, this._serializer.serializeValue(item));
                }
                return cbor4.map(m3, this._stable);
              } else {
                const m3 = /* @__PURE__ */ new Map();
                for (const [key, item] of Object.entries(value4)) {
                  m3.set(key, this._serializer.serializeValue(item));
                }
                return cbor4.map(m3, this._stable);
              }
            default:
              throw new Error("Invalid value.");
          }
        }
      };
      exports.JsonDefaultCborEncoder = JsonDefaultCborEncoder;
      var ToCborEncoder = class {
        constructor() {
          this.name = "cborEncoder";
          this.priority = -90;
        }
        match(value4) {
          return typeof value4 == "object" && typeof value4["toCBOR"] == "function";
        }
        encode(value4) {
          return value4.toCBOR();
        }
      };
      exports.ToCborEncoder = ToCborEncoder;
      var CborSerializer = class {
        constructor() {
          this._encoders = /* @__PURE__ */ new Set();
        }
        static withDefaultEncoders(stable = false) {
          const s2 = new this();
          s2.addEncoder(new JsonDefaultCborEncoder(s2, stable));
          s2.addEncoder(new ToCborEncoder());
          return s2;
        }
        removeEncoder(name) {
          for (const encoder of this._encoders.values()) {
            if (encoder.name == name) {
              this._encoders.delete(encoder);
            }
          }
        }
        addEncoder(encoder) {
          this._encoders.add(encoder);
        }
        getEncoderFor(value4) {
          let chosenEncoder = null;
          for (const encoder of this._encoders) {
            if (!chosenEncoder || encoder.priority > chosenEncoder.priority) {
              if (encoder.match(value4)) {
                chosenEncoder = encoder;
              }
            }
          }
          if (chosenEncoder === null) {
            throw new Error("Could not find an encoder for value.");
          }
          return chosenEncoder;
        }
        serializeValue(value4) {
          return this.getEncoderFor(value4).encode(value4);
        }
        serialize(value4) {
          return this.serializeValue(value4);
        }
      };
      exports.CborSerializer = CborSerializer;
      var SelfDescribeCborSerializer2 = class extends CborSerializer {
        serialize(value4) {
          return cbor4.raw(new Uint8Array([
            // Self describe CBOR.
            ...new Uint8Array([217, 217, 247]),
            ...new Uint8Array(super.serializeValue(value4))
          ]));
        }
      };
      exports.SelfDescribeCborSerializer = SelfDescribeCborSerializer2;
    }
  });

  // node_modules/simple-cbor/src/index.js
  var require_src2 = __commonJS({
    "node_modules/simple-cbor/src/index.js"(exports) {
      "use strict";
      function __export2(m3) {
        for (var p3 in m3)
          if (!exports.hasOwnProperty(p3))
            exports[p3] = m3[p3];
      }
      var __importStar = exports && exports.__importStar || function(mod2) {
        if (mod2 && mod2.__esModule)
          return mod2;
        var result = {};
        if (mod2 != null) {
          for (var k2 in mod2)
            if (Object.hasOwnProperty.call(mod2, k2))
              result[k2] = mod2[k2];
        }
        result["default"] = mod2;
        return result;
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      __export2(require_serializer());
      var value4 = __importStar(require_value());
      exports.value = value4;
    }
  });

  // node_modules/@dfinity/agent/lib/esm/cbor.js
  function encode3(value4) {
    return serializer.serialize(value4);
  }
  function decodePositiveBigInt(buf) {
    const len = buf.byteLength;
    let res = BigInt(0);
    for (let i = 0; i < len; i++) {
      res = res * BigInt(256) + BigInt(buf[i]);
    }
    return res;
  }
  function decode3(input) {
    const buffer = new Uint8Array(input);
    const decoder = new Uint8ArrayDecoder({
      size: buffer.byteLength,
      tags: {
        // Override tags 2 and 3 for BigInt support (borc supports only BigNumber).
        2: (val) => decodePositiveBigInt(val),
        3: (val) => -decodePositiveBigInt(val),
        [CborTag.Semantic]: (value4) => value4
      }
    });
    try {
      return decoder.decodeFirst(buffer);
    } catch (e3) {
      throw new Error(`Failed to decode CBOR: ${e3}, input: ${toHex(buffer)}`);
    }
  }
  var import_borc2, cbor, import_simple_cbor, PrincipalEncoder, BufferEncoder, BigIntEncoder, serializer, CborTag, Uint8ArrayDecoder;
  var init_cbor = __esm({
    "node_modules/@dfinity/agent/lib/esm/cbor.js"() {
      import_borc2 = __toESM(require_src());
      cbor = __toESM(require_src2());
      import_simple_cbor = __toESM(require_src2());
      init_buffer();
      PrincipalEncoder = class {
        get name() {
          return "Principal";
        }
        get priority() {
          return 0;
        }
        match(value4) {
          return value4 && value4._isPrincipal === true;
        }
        encode(v2) {
          return cbor.value.bytes(v2.toUint8Array());
        }
      };
      BufferEncoder = class {
        get name() {
          return "Buffer";
        }
        get priority() {
          return 1;
        }
        match(value4) {
          return value4 instanceof ArrayBuffer || ArrayBuffer.isView(value4);
        }
        encode(v2) {
          return cbor.value.bytes(new Uint8Array(v2));
        }
      };
      BigIntEncoder = class {
        get name() {
          return "BigInt";
        }
        get priority() {
          return 1;
        }
        match(value4) {
          return typeof value4 === `bigint`;
        }
        encode(v2) {
          if (v2 > BigInt(0)) {
            return cbor.value.tagged(2, cbor.value.bytes(fromHex(v2.toString(16))));
          } else {
            return cbor.value.tagged(3, cbor.value.bytes(fromHex((BigInt("-1") * v2).toString(16))));
          }
        }
      };
      serializer = import_simple_cbor.SelfDescribeCborSerializer.withDefaultEncoders(true);
      serializer.addEncoder(new PrincipalEncoder());
      serializer.addEncoder(new BufferEncoder());
      serializer.addEncoder(new BigIntEncoder());
      (function(CborTag2) {
        CborTag2[CborTag2["Uint64LittleEndian"] = 71] = "Uint64LittleEndian";
        CborTag2[CborTag2["Semantic"] = 55799] = "Semantic";
      })(CborTag || (CborTag = {}));
      Uint8ArrayDecoder = class extends import_borc2.default.Decoder {
        createByteString(raw) {
          return concat(...raw);
        }
        createByteStringFromHeap(start, end) {
          if (start === end) {
            return new ArrayBuffer(0);
          }
          return new Uint8Array(this._heap.slice(start, end));
        }
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/utils/random.js
  var randomNumber;
  var init_random = __esm({
    "node_modules/@dfinity/agent/lib/esm/utils/random.js"() {
      randomNumber = () => {
        if (typeof window !== "undefined" && !!window.crypto && !!window.crypto.getRandomValues) {
          const array = new Uint32Array(1);
          window.crypto.getRandomValues(array);
          return array[0];
        }
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
          const array = new Uint32Array(1);
          crypto.getRandomValues(array);
          return array[0];
        }
        if (typeof crypto !== "undefined" && crypto.randomInt) {
          return crypto.randomInt(0, 4294967295);
        }
        return Math.floor(Math.random() * 4294967295);
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/http/types.js
  function makeNonce() {
    const buffer = new ArrayBuffer(16);
    const view = new DataView(buffer);
    const rand1 = randomNumber();
    const rand2 = randomNumber();
    const rand3 = randomNumber();
    const rand4 = randomNumber();
    view.setUint32(0, rand1);
    view.setUint32(4, rand2);
    view.setUint32(8, rand3);
    view.setUint32(12, rand4);
    return buffer;
  }
  var SubmitRequestType;
  var init_types2 = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/http/types.js"() {
      init_random();
      (function(SubmitRequestType2) {
        SubmitRequestType2["Call"] = "call";
      })(SubmitRequestType || (SubmitRequestType = {}));
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/http/transforms.js
  function makeNonceTransform(nonceFn = makeNonce) {
    return async (request2) => {
      const headers = request2.request.headers;
      request2.request.headers = headers;
      if (request2.endpoint === "call") {
        request2.body.nonce = nonceFn();
      }
    };
  }
  function httpHeadersTransform(headers) {
    const headerFields = [];
    headers.forEach((value4, key) => {
      headerFields.push([key, value4]);
    });
    return headerFields;
  }
  var cbor2, NANOSECONDS_PER_MILLISECONDS, REPLICA_PERMITTED_DRIFT_MILLISECONDS, Expiry;
  var init_transforms = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/http/transforms.js"() {
      init_esm2();
      cbor2 = __toESM(require_src2());
      init_types2();
      NANOSECONDS_PER_MILLISECONDS = BigInt(1e6);
      REPLICA_PERMITTED_DRIFT_MILLISECONDS = 60 * 1e3;
      Expiry = class {
        constructor(deltaInMSec) {
          if (deltaInMSec < 90 * 1e3) {
            const raw_value2 = BigInt(Date.now() + deltaInMSec) * NANOSECONDS_PER_MILLISECONDS;
            const ingress_as_seconds2 = raw_value2 / BigInt(1e9);
            this._value = ingress_as_seconds2 * BigInt(1e9);
            return;
          }
          const raw_value = BigInt(Math.floor(Date.now() + deltaInMSec - REPLICA_PERMITTED_DRIFT_MILLISECONDS)) * NANOSECONDS_PER_MILLISECONDS;
          const ingress_as_seconds = raw_value / BigInt(1e9);
          const ingress_as_minutes = ingress_as_seconds / BigInt(60);
          const rounded_down_nanos = ingress_as_minutes * BigInt(60) * BigInt(1e9);
          this._value = rounded_down_nanos;
        }
        toCBOR() {
          return cbor2.value.u64(this._value.toString(16), 16);
        }
        toHash() {
          return lebEncode(this._value);
        }
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/http/errors.js
  var AgentHTTPResponseError;
  var init_errors2 = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/http/errors.js"() {
      init_errors();
      AgentHTTPResponseError = class extends AgentError {
        constructor(message, response) {
          super(message);
          this.response = response;
          this.name = this.constructor.name;
          Object.setPrototypeOf(this, new.target.prototype);
        }
      };
    }
  });

  // node_modules/@noble/curves/esm/abstract/utils.js
  var utils_exports = {};
  __export(utils_exports, {
    aInRange: () => aInRange,
    abool: () => abool,
    abytes: () => abytes2,
    bitGet: () => bitGet,
    bitLen: () => bitLen,
    bitMask: () => bitMask,
    bitSet: () => bitSet,
    bytesToHex: () => bytesToHex,
    bytesToNumberBE: () => bytesToNumberBE,
    bytesToNumberLE: () => bytesToNumberLE,
    concatBytes: () => concatBytes,
    createHmacDrbg: () => createHmacDrbg,
    ensureBytes: () => ensureBytes,
    equalBytes: () => equalBytes,
    hexToBytes: () => hexToBytes,
    hexToNumber: () => hexToNumber,
    inRange: () => inRange,
    isBytes: () => isBytes2,
    memoized: () => memoized,
    notImplemented: () => notImplemented,
    numberToBytesBE: () => numberToBytesBE,
    numberToBytesLE: () => numberToBytesLE,
    numberToHexUnpadded: () => numberToHexUnpadded,
    numberToVarBytesBE: () => numberToVarBytesBE,
    utf8ToBytes: () => utf8ToBytes2,
    validateObject: () => validateObject
  });
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abytes2(item) {
    if (!isBytes2(item))
      throw new Error("Uint8Array expected");
  }
  function abool(title, value4) {
    if (typeof value4 !== "boolean")
      throw new Error(title + " boolean expected, got " + value4);
  }
  function bytesToHex(bytes) {
    abytes2(bytes);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  function numberToHexUnpadded(num) {
    const hex = num.toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    return hex === "" ? _0n : BigInt("0x" + hex);
  }
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === void 0 || n2 === void 0) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber(bytesToHex(bytes));
  }
  function bytesToNumberLE(bytes) {
    abytes2(bytes);
    return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
  }
  function numberToBytesBE(n2, len) {
    return hexToBytes(n2.toString(16).padStart(len * 2, "0"));
  }
  function numberToBytesLE(n2, len) {
    return numberToBytesBE(n2, len).reverse();
  }
  function numberToVarBytesBE(n2) {
    return hexToBytes(numberToHexUnpadded(n2));
  }
  function ensureBytes(title, hex, expectedLength) {
    let res;
    if (typeof hex === "string") {
      try {
        res = hexToBytes(hex);
      } catch (e3) {
        throw new Error(title + " must be hex string or Uint8Array, cause: " + e3);
      }
    } else if (isBytes2(hex)) {
      res = Uint8Array.from(hex);
    } else {
      throw new Error(title + " must be hex string or Uint8Array");
    }
    const len = res.length;
    if (typeof expectedLength === "number" && len !== expectedLength)
      throw new Error(title + " of length " + expectedLength + " expected, got " + len);
    return res;
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0; i < arrays.length; i++) {
      const a = arrays[i];
      abytes2(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function equalBytes(a, b3) {
    if (a.length !== b3.length)
      return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
      diff |= a[i] ^ b3[i];
    return diff === 0;
  }
  function utf8ToBytes2(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function inRange(n2, min, max) {
    return isPosBig(n2) && isPosBig(min) && isPosBig(max) && min <= n2 && n2 < max;
  }
  function aInRange(title, n2, min, max) {
    if (!inRange(n2, min, max))
      throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n2);
  }
  function bitLen(n2) {
    let len;
    for (len = 0; n2 > _0n; n2 >>= _1n, len += 1)
      ;
    return len;
  }
  function bitGet(n2, pos) {
    return n2 >> BigInt(pos) & _1n;
  }
  function bitSet(n2, pos, value4) {
    return n2 | (value4 ? _1n : _0n) << BigInt(pos);
  }
  function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    if (typeof hashLen !== "number" || hashLen < 2)
      throw new Error("hashLen must be a number");
    if (typeof qByteLen !== "number" || qByteLen < 2)
      throw new Error("qByteLen must be a number");
    if (typeof hmacFn !== "function")
      throw new Error("hmacFn must be a function");
    let v2 = u8n(hashLen);
    let k2 = u8n(hashLen);
    let i = 0;
    const reset = () => {
      v2.fill(1);
      k2.fill(0);
      i = 0;
    };
    const h3 = (...b3) => hmacFn(k2, v2, ...b3);
    const reseed = (seed = u8n()) => {
      k2 = h3(u8fr([0]), seed);
      v2 = h3();
      if (seed.length === 0)
        return;
      k2 = h3(u8fr([1]), seed);
      v2 = h3();
    };
    const gen = () => {
      if (i++ >= 1e3)
        throw new Error("drbg: tried 1000 values");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v2 = h3();
        const sl = v2.slice();
        out.push(sl);
        len += v2.length;
      }
      return concatBytes(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = void 0;
      while (!(res = pred(gen())))
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  function validateObject(object, validators, optValidators = {}) {
    const checkField = (fieldName, type, isOptional) => {
      const checkVal = validatorFns[type];
      if (typeof checkVal !== "function")
        throw new Error("invalid validator function");
      const val = object[fieldName];
      if (isOptional && val === void 0)
        return;
      if (!checkVal(val, object)) {
        throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
      }
    };
    for (const [fieldName, type] of Object.entries(validators))
      checkField(fieldName, type, false);
    for (const [fieldName, type] of Object.entries(optValidators))
      checkField(fieldName, type, true);
    return object;
  }
  function memoized(fn) {
    const map = /* @__PURE__ */ new WeakMap();
    return (arg, ...args) => {
      const val = map.get(arg);
      if (val !== void 0)
        return val;
      const computed = fn(arg, ...args);
      map.set(arg, computed);
      return computed;
    };
  }
  var _0n, _1n, _2n, hexes, asciis, isPosBig, bitMask, u8n, u8fr, validatorFns, notImplemented;
  var init_utils2 = __esm({
    "node_modules/@noble/curves/esm/abstract/utils.js"() {
      _0n = /* @__PURE__ */ BigInt(0);
      _1n = /* @__PURE__ */ BigInt(1);
      _2n = /* @__PURE__ */ BigInt(2);
      hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_2, i) => i.toString(16).padStart(2, "0"));
      asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
      isPosBig = (n2) => typeof n2 === "bigint" && _0n <= n2;
      bitMask = (n2) => (_2n << BigInt(n2 - 1)) - _1n;
      u8n = (data) => new Uint8Array(data);
      u8fr = (arr) => Uint8Array.from(arr);
      validatorFns = {
        bigint: (val) => typeof val === "bigint",
        function: (val) => typeof val === "function",
        boolean: (val) => typeof val === "boolean",
        string: (val) => typeof val === "string",
        stringOrUint8Array: (val) => typeof val === "string" || isBytes2(val),
        isSafeInteger: (val) => Number.isSafeInteger(val),
        array: (val) => Array.isArray(val),
        field: (val, object) => object.Fp.isValid(val),
        hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
      };
      notImplemented = () => {
        throw new Error("not implemented");
      };
    }
  });

  // node_modules/@noble/curves/esm/abstract/modular.js
  function mod(a, b3) {
    const result = a % b3;
    return result >= _0n2 ? result : b3 + result;
  }
  function pow(num, power, modulo) {
    if (power < _0n2)
      throw new Error("invalid exponent, negatives unsupported");
    if (modulo <= _0n2)
      throw new Error("invalid modulus");
    if (modulo === _1n2)
      return _0n2;
    let res = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        res = res * num % modulo;
      num = num * num % modulo;
      power >>= _1n2;
    }
    return res;
  }
  function pow2(x5, power, modulo) {
    let res = x5;
    while (power-- > _0n2) {
      res *= res;
      res %= modulo;
    }
    return res;
  }
  function invert(number, modulo) {
    if (number === _0n2)
      throw new Error("invert: expected non-zero number");
    if (modulo <= _0n2)
      throw new Error("invert: expected positive modulus, got " + modulo);
    let a = mod(number, modulo);
    let b3 = modulo;
    let x5 = _0n2, y = _1n2, u2 = _1n2, v2 = _0n2;
    while (a !== _0n2) {
      const q = b3 / a;
      const r = b3 % a;
      const m3 = x5 - u2 * q;
      const n2 = y - v2 * q;
      b3 = a, a = r, x5 = u2, y = v2, u2 = m3, v2 = n2;
    }
    const gcd = b3;
    if (gcd !== _1n2)
      throw new Error("invert: does not exist");
    return mod(x5, modulo);
  }
  function tonelliShanks(P2) {
    const legendreC = (P2 - _1n2) / _2n2;
    let Q, S2, Z;
    for (Q = P2 - _1n2, S2 = 0; Q % _2n2 === _0n2; Q /= _2n2, S2++)
      ;
    for (Z = _2n2; Z < P2 && pow(Z, legendreC, P2) !== P2 - _1n2; Z++) {
      if (Z > 1e3)
        throw new Error("Cannot find square root: likely non-prime P");
    }
    if (S2 === 1) {
      const p1div4 = (P2 + _1n2) / _4n;
      return function tonelliFast(Fp4, n2) {
        const root = Fp4.pow(n2, p1div4);
        if (!Fp4.eql(Fp4.sqr(root), n2))
          throw new Error("Cannot find square root");
        return root;
      };
    }
    const Q1div2 = (Q + _1n2) / _2n2;
    return function tonelliSlow(Fp4, n2) {
      if (Fp4.pow(n2, legendreC) === Fp4.neg(Fp4.ONE))
        throw new Error("Cannot find square root");
      let r = S2;
      let g3 = Fp4.pow(Fp4.mul(Fp4.ONE, Z), Q);
      let x5 = Fp4.pow(n2, Q1div2);
      let b3 = Fp4.pow(n2, Q);
      while (!Fp4.eql(b3, Fp4.ONE)) {
        if (Fp4.eql(b3, Fp4.ZERO))
          return Fp4.ZERO;
        let m3 = 1;
        for (let t2 = Fp4.sqr(b3); m3 < r; m3++) {
          if (Fp4.eql(t2, Fp4.ONE))
            break;
          t2 = Fp4.sqr(t2);
        }
        const ge2 = Fp4.pow(g3, _1n2 << BigInt(r - m3 - 1));
        g3 = Fp4.sqr(ge2);
        x5 = Fp4.mul(x5, ge2);
        b3 = Fp4.mul(b3, g3);
        r = m3;
      }
      return x5;
    };
  }
  function FpSqrt(P2) {
    if (P2 % _4n === _3n) {
      const p1div4 = (P2 + _1n2) / _4n;
      return function sqrt3mod4(Fp4, n2) {
        const root = Fp4.pow(n2, p1div4);
        if (!Fp4.eql(Fp4.sqr(root), n2))
          throw new Error("Cannot find square root");
        return root;
      };
    }
    if (P2 % _8n === _5n) {
      const c1 = (P2 - _5n) / _8n;
      return function sqrt5mod8(Fp4, n2) {
        const n22 = Fp4.mul(n2, _2n2);
        const v2 = Fp4.pow(n22, c1);
        const nv = Fp4.mul(n2, v2);
        const i = Fp4.mul(Fp4.mul(nv, _2n2), v2);
        const root = Fp4.mul(nv, Fp4.sub(i, Fp4.ONE));
        if (!Fp4.eql(Fp4.sqr(root), n2))
          throw new Error("Cannot find square root");
        return root;
      };
    }
    if (P2 % _16n === _9n) {
    }
    return tonelliShanks(P2);
  }
  function validateField(field) {
    const initial = {
      ORDER: "bigint",
      MASK: "bigint",
      BYTES: "isSafeInteger",
      BITS: "isSafeInteger"
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
      map[val] = "function";
      return map;
    }, initial);
    return validateObject(field, opts);
  }
  function FpPow(f4, num, power) {
    if (power < _0n2)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n2)
      return f4.ONE;
    if (power === _1n2)
      return num;
    let p3 = f4.ONE;
    let d2 = num;
    while (power > _0n2) {
      if (power & _1n2)
        p3 = f4.mul(p3, d2);
      d2 = f4.sqr(d2);
      power >>= _1n2;
    }
    return p3;
  }
  function FpInvertBatch(f4, nums) {
    const tmp = new Array(nums.length);
    const lastMultiplied = nums.reduce((acc, num, i) => {
      if (f4.is0(num))
        return acc;
      tmp[i] = acc;
      return f4.mul(acc, num);
    }, f4.ONE);
    const inverted = f4.inv(lastMultiplied);
    nums.reduceRight((acc, num, i) => {
      if (f4.is0(num))
        return acc;
      tmp[i] = f4.mul(acc, tmp[i]);
      return f4.mul(acc, num);
    }, inverted);
    return tmp;
  }
  function FpLegendre(order) {
    const legendreConst = (order - _1n2) / _2n2;
    return (f4, x5) => f4.pow(x5, legendreConst);
  }
  function nLength(n2, nBitLength) {
    const _nBitLength = nBitLength !== void 0 ? nBitLength : n2.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  function Field(ORDER, bitLen2, isLE = false, redef = {}) {
    if (ORDER <= _0n2)
      throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
    const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, bitLen2);
    if (BYTES > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    let sqrtP;
    const f4 = Object.freeze({
      ORDER,
      isLE,
      BITS,
      BYTES,
      MASK: bitMask(BITS),
      ZERO: _0n2,
      ONE: _1n2,
      create: (num) => mod(num, ORDER),
      isValid: (num) => {
        if (typeof num !== "bigint")
          throw new Error("invalid field element: expected bigint, got " + typeof num);
        return _0n2 <= num && num < ORDER;
      },
      is0: (num) => num === _0n2,
      isOdd: (num) => (num & _1n2) === _1n2,
      neg: (num) => mod(-num, ORDER),
      eql: (lhs, rhs) => lhs === rhs,
      sqr: (num) => mod(num * num, ORDER),
      add: (lhs, rhs) => mod(lhs + rhs, ORDER),
      sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
      mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
      pow: (num, power) => FpPow(f4, num, power),
      div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
      // Same as above, but doesn't normalize
      sqrN: (num) => num * num,
      addN: (lhs, rhs) => lhs + rhs,
      subN: (lhs, rhs) => lhs - rhs,
      mulN: (lhs, rhs) => lhs * rhs,
      inv: (num) => invert(num, ORDER),
      sqrt: redef.sqrt || ((n2) => {
        if (!sqrtP)
          sqrtP = FpSqrt(ORDER);
        return sqrtP(f4, n2);
      }),
      invertBatch: (lst) => FpInvertBatch(f4, lst),
      // TODO: do we really need constant cmov?
      // We don't have const-time bigints anyway, so probably will be not very useful
      cmov: (a, b3, c3) => c3 ? b3 : a,
      toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
      fromBytes: (bytes) => {
        if (bytes.length !== BYTES)
          throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
        return isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      }
    });
    return Object.freeze(f4);
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE = false) {
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    if (len < 16 || len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num, fieldOrder - _1n2) + _1n2;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
  }
  var _0n2, _1n2, _2n2, _3n, _4n, _5n, _8n, _9n, _16n, isNegativeLE, FIELD_FIELDS;
  var init_modular = __esm({
    "node_modules/@noble/curves/esm/abstract/modular.js"() {
      init_utils2();
      _0n2 = BigInt(0);
      _1n2 = BigInt(1);
      _2n2 = /* @__PURE__ */ BigInt(2);
      _3n = /* @__PURE__ */ BigInt(3);
      _4n = /* @__PURE__ */ BigInt(4);
      _5n = /* @__PURE__ */ BigInt(5);
      _8n = /* @__PURE__ */ BigInt(8);
      _9n = /* @__PURE__ */ BigInt(9);
      _16n = /* @__PURE__ */ BigInt(16);
      isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
      FIELD_FIELDS = [
        "create",
        "isValid",
        "is0",
        "neg",
        "inv",
        "sqrt",
        "sqr",
        "eql",
        "add",
        "sub",
        "mul",
        "pow",
        "div",
        "addN",
        "subN",
        "mulN",
        "sqrN"
      ];
    }
  });

  // node_modules/@noble/curves/esm/abstract/hash-to-curve.js
  function i2osp(value4, length) {
    anum(value4);
    anum(length);
    if (value4 < 0 || value4 >= 1 << 8 * length)
      throw new Error("invalid I2OSP input: " + value4);
    const res = Array.from({ length }).fill(0);
    for (let i = length - 1; i >= 0; i--) {
      res[i] = value4 & 255;
      value4 >>>= 8;
    }
    return new Uint8Array(res);
  }
  function strxor(a, b3) {
    const arr = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
      arr[i] = a[i] ^ b3[i];
    }
    return arr;
  }
  function anum(item) {
    if (!Number.isSafeInteger(item))
      throw new Error("number expected");
  }
  function expand_message_xmd(msg, DST, lenInBytes, H) {
    abytes2(msg);
    abytes2(DST);
    anum(lenInBytes);
    if (DST.length > 255)
      DST = H(concatBytes(utf8ToBytes2("H2C-OVERSIZE-DST-"), DST));
    const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
    const ell = Math.ceil(lenInBytes / b_in_bytes);
    if (lenInBytes > 65535 || ell > 255)
      throw new Error("expand_message_xmd: invalid lenInBytes");
    const DST_prime = concatBytes(DST, i2osp(DST.length, 1));
    const Z_pad = i2osp(0, r_in_bytes);
    const l_i_b_str = i2osp(lenInBytes, 2);
    const b3 = new Array(ell);
    const b_0 = H(concatBytes(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
    b3[0] = H(concatBytes(b_0, i2osp(1, 1), DST_prime));
    for (let i = 1; i <= ell; i++) {
      const args = [strxor(b_0, b3[i - 1]), i2osp(i + 1, 1), DST_prime];
      b3[i] = H(concatBytes(...args));
    }
    const pseudo_random_bytes = concatBytes(...b3);
    return pseudo_random_bytes.slice(0, lenInBytes);
  }
  function expand_message_xof(msg, DST, lenInBytes, k2, H) {
    abytes2(msg);
    abytes2(DST);
    anum(lenInBytes);
    if (DST.length > 255) {
      const dkLen = Math.ceil(2 * k2 / 8);
      DST = H.create({ dkLen }).update(utf8ToBytes2("H2C-OVERSIZE-DST-")).update(DST).digest();
    }
    if (lenInBytes > 65535 || DST.length > 255)
      throw new Error("expand_message_xof: invalid lenInBytes");
    return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp(lenInBytes, 2)).update(DST).update(i2osp(DST.length, 1)).digest();
  }
  function hash_to_field(msg, count, options) {
    validateObject(options, {
      DST: "stringOrUint8Array",
      p: "bigint",
      m: "isSafeInteger",
      k: "isSafeInteger",
      hash: "hash"
    });
    const { p: p3, k: k2, m: m3, hash: hash2, expand, DST: _DST } = options;
    abytes2(msg);
    anum(count);
    const DST = typeof _DST === "string" ? utf8ToBytes2(_DST) : _DST;
    const log2p = p3.toString(2).length;
    const L3 = Math.ceil((log2p + k2) / 8);
    const len_in_bytes = count * m3 * L3;
    let prb;
    if (expand === "xmd") {
      prb = expand_message_xmd(msg, DST, len_in_bytes, hash2);
    } else if (expand === "xof") {
      prb = expand_message_xof(msg, DST, len_in_bytes, k2, hash2);
    } else if (expand === "_internal_pass") {
      prb = msg;
    } else {
      throw new Error('expand must be "xmd" or "xof"');
    }
    const u2 = new Array(count);
    for (let i = 0; i < count; i++) {
      const e3 = new Array(m3);
      for (let j2 = 0; j2 < m3; j2++) {
        const elm_offset = L3 * (j2 + i * m3);
        const tv = prb.subarray(elm_offset, elm_offset + L3);
        e3[j2] = mod(os2ip(tv), p3);
      }
      u2[i] = e3;
    }
    return u2;
  }
  function isogenyMap(field, map) {
    const COEFF = map.map((i) => Array.from(i).reverse());
    return (x5, y) => {
      const [xNum, xDen, yNum, yDen] = COEFF.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x5), i)));
      x5 = field.div(xNum, xDen);
      y = field.mul(y, field.div(yNum, yDen));
      return { x: x5, y };
    };
  }
  function createHasher(Point, mapToCurve, def) {
    if (typeof mapToCurve !== "function")
      throw new Error("mapToCurve() must be defined");
    return {
      // Encodes byte string to elliptic curve.
      // hash_to_curve from https://www.rfc-editor.org/rfc/rfc9380#section-3
      hashToCurve(msg, options) {
        const u2 = hash_to_field(msg, 2, { ...def, DST: def.DST, ...options });
        const u0 = Point.fromAffine(mapToCurve(u2[0]));
        const u1 = Point.fromAffine(mapToCurve(u2[1]));
        const P2 = u0.add(u1).clearCofactor();
        P2.assertValidity();
        return P2;
      },
      // Encodes byte string to elliptic curve.
      // encode_to_curve from https://www.rfc-editor.org/rfc/rfc9380#section-3
      encodeToCurve(msg, options) {
        const u2 = hash_to_field(msg, 1, { ...def, DST: def.encodeDST, ...options });
        const P2 = Point.fromAffine(mapToCurve(u2[0])).clearCofactor();
        P2.assertValidity();
        return P2;
      },
      // Same as encodeToCurve, but without hash
      mapToCurve(scalars) {
        if (!Array.isArray(scalars))
          throw new Error("mapToCurve: expected array of bigints");
        for (const i of scalars)
          if (typeof i !== "bigint")
            throw new Error("mapToCurve: expected array of bigints");
        const P2 = Point.fromAffine(mapToCurve(scalars)).clearCofactor();
        P2.assertValidity();
        return P2;
      }
    };
  }
  var os2ip;
  var init_hash_to_curve = __esm({
    "node_modules/@noble/curves/esm/abstract/hash-to-curve.js"() {
      init_modular();
      init_utils2();
      os2ip = bytesToNumberBE;
    }
  });

  // node_modules/@noble/curves/esm/abstract/curve.js
  function constTimeNegate(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
  }
  function validateW(W4, bits) {
    if (!Number.isSafeInteger(W4) || W4 <= 0 || W4 > bits)
      throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W4);
  }
  function calcWOpts(W4, bits) {
    validateW(W4, bits);
    const windows = Math.ceil(bits / W4) + 1;
    const windowSize = 2 ** (W4 - 1);
    return { windows, windowSize };
  }
  function validateMSMPoints(points, c3) {
    if (!Array.isArray(points))
      throw new Error("array expected");
    points.forEach((p3, i) => {
      if (!(p3 instanceof c3))
        throw new Error("invalid point at index " + i);
    });
  }
  function validateMSMScalars(scalars, field) {
    if (!Array.isArray(scalars))
      throw new Error("array of scalars expected");
    scalars.forEach((s2, i) => {
      if (!field.isValid(s2))
        throw new Error("invalid scalar at index " + i);
    });
  }
  function getW(P2) {
    return pointWindowSizes.get(P2) || 1;
  }
  function wNAF(c3, bits) {
    return {
      constTimeNegate,
      hasPrecomputes(elm) {
        return getW(elm) !== 1;
      },
      // non-const time multiplication ladder
      unsafeLadder(elm, n2, p3 = c3.ZERO) {
        let d2 = elm;
        while (n2 > _0n3) {
          if (n2 & _1n3)
            p3 = p3.add(d2);
          d2 = d2.double();
          n2 >>= _1n3;
        }
        return p3;
      },
      /**
       * Creates a wNAF precomputation window. Used for caching.
       * Default window size is set by `utils.precompute()` and is equal to 8.
       * Number of precomputed points depends on the curve size:
       * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
       * - 𝑊 is the window size
       * - 𝑛 is the bitlength of the curve order.
       * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
       * @param elm Point instance
       * @param W window size
       * @returns precomputed point tables flattened to a single array
       */
      precomputeWindow(elm, W4) {
        const { windows, windowSize } = calcWOpts(W4, bits);
        const points = [];
        let p3 = elm;
        let base = p3;
        for (let window2 = 0; window2 < windows; window2++) {
          base = p3;
          points.push(base);
          for (let i = 1; i < windowSize; i++) {
            base = base.add(p3);
            points.push(base);
          }
          p3 = base.double();
        }
        return points;
      },
      /**
       * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
       * @param W window size
       * @param precomputes precomputed tables
       * @param n scalar (we don't check here, but should be less than curve order)
       * @returns real and fake (for const-time) points
       */
      wNAF(W4, precomputes, n2) {
        const { windows, windowSize } = calcWOpts(W4, bits);
        let p3 = c3.ZERO;
        let f4 = c3.BASE;
        const mask = BigInt(2 ** W4 - 1);
        const maxNumber = 2 ** W4;
        const shiftBy = BigInt(W4);
        for (let window2 = 0; window2 < windows; window2++) {
          const offset = window2 * windowSize;
          let wbits = Number(n2 & mask);
          n2 >>= shiftBy;
          if (wbits > windowSize) {
            wbits -= maxNumber;
            n2 += _1n3;
          }
          const offset1 = offset;
          const offset2 = offset + Math.abs(wbits) - 1;
          const cond1 = window2 % 2 !== 0;
          const cond2 = wbits < 0;
          if (wbits === 0) {
            f4 = f4.add(constTimeNegate(cond1, precomputes[offset1]));
          } else {
            p3 = p3.add(constTimeNegate(cond2, precomputes[offset2]));
          }
        }
        return { p: p3, f: f4 };
      },
      /**
       * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
       * @param W window size
       * @param precomputes precomputed tables
       * @param n scalar (we don't check here, but should be less than curve order)
       * @param acc accumulator point to add result of multiplication
       * @returns point
       */
      wNAFUnsafe(W4, precomputes, n2, acc = c3.ZERO) {
        const { windows, windowSize } = calcWOpts(W4, bits);
        const mask = BigInt(2 ** W4 - 1);
        const maxNumber = 2 ** W4;
        const shiftBy = BigInt(W4);
        for (let window2 = 0; window2 < windows; window2++) {
          const offset = window2 * windowSize;
          if (n2 === _0n3)
            break;
          let wbits = Number(n2 & mask);
          n2 >>= shiftBy;
          if (wbits > windowSize) {
            wbits -= maxNumber;
            n2 += _1n3;
          }
          if (wbits === 0)
            continue;
          let curr = precomputes[offset + Math.abs(wbits) - 1];
          if (wbits < 0)
            curr = curr.negate();
          acc = acc.add(curr);
        }
        return acc;
      },
      getPrecomputes(W4, P2, transform) {
        let comp = pointPrecomputes.get(P2);
        if (!comp) {
          comp = this.precomputeWindow(P2, W4);
          if (W4 !== 1)
            pointPrecomputes.set(P2, transform(comp));
        }
        return comp;
      },
      wNAFCached(P2, n2, transform) {
        const W4 = getW(P2);
        return this.wNAF(W4, this.getPrecomputes(W4, P2, transform), n2);
      },
      wNAFCachedUnsafe(P2, n2, transform, prev) {
        const W4 = getW(P2);
        if (W4 === 1)
          return this.unsafeLadder(P2, n2, prev);
        return this.wNAFUnsafe(W4, this.getPrecomputes(W4, P2, transform), n2, prev);
      },
      // We calculate precomputes for elliptic curve point multiplication
      // using windowed method. This specifies window size and
      // stores precomputed values. Usually only base point would be precomputed.
      setWindowSize(P2, W4) {
        validateW(W4, bits);
        pointWindowSizes.set(P2, W4);
        pointPrecomputes.delete(P2);
      }
    };
  }
  function pippenger(c3, fieldN, points, scalars) {
    validateMSMPoints(points, c3);
    validateMSMScalars(scalars, fieldN);
    if (points.length !== scalars.length)
      throw new Error("arrays of points and scalars must have equal length");
    const zero = c3.ZERO;
    const wbits = bitLen(BigInt(points.length));
    const windowSize = wbits > 12 ? wbits - 3 : wbits > 4 ? wbits - 2 : wbits ? 2 : 1;
    const MASK = (1 << windowSize) - 1;
    const buckets = new Array(MASK + 1).fill(zero);
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits; i >= 0; i -= windowSize) {
      buckets.fill(zero);
      for (let j2 = 0; j2 < scalars.length; j2++) {
        const scalar = scalars[j2];
        const wbits2 = Number(scalar >> BigInt(i) & BigInt(MASK));
        buckets[wbits2] = buckets[wbits2].add(points[j2]);
      }
      let resI = zero;
      for (let j2 = buckets.length - 1, sumI = zero; j2 > 0; j2--) {
        sumI = sumI.add(buckets[j2]);
        resI = resI.add(sumI);
      }
      sum = sum.add(resI);
      if (i !== 0)
        for (let j2 = 0; j2 < windowSize; j2++)
          sum = sum.double();
    }
    return sum;
  }
  function validateBasic(curve) {
    validateField(curve.Fp);
    validateObject(curve, {
      n: "bigint",
      h: "bigint",
      Gx: "field",
      Gy: "field"
    }, {
      nBitLength: "isSafeInteger",
      nByteLength: "isSafeInteger"
    });
    return Object.freeze({
      ...nLength(curve.n, curve.nBitLength),
      ...curve,
      ...{ p: curve.Fp.ORDER }
    });
  }
  var _0n3, _1n3, pointPrecomputes, pointWindowSizes;
  var init_curve = __esm({
    "node_modules/@noble/curves/esm/abstract/curve.js"() {
      init_modular();
      init_utils2();
      _0n3 = BigInt(0);
      _1n3 = BigInt(1);
      pointPrecomputes = /* @__PURE__ */ new WeakMap();
      pointWindowSizes = /* @__PURE__ */ new WeakMap();
    }
  });

  // node_modules/@noble/curves/esm/abstract/weierstrass.js
  function validatePointOpts(curve) {
    const opts = validateBasic(curve);
    validateObject(opts, {
      a: "field",
      b: "field"
    }, {
      allowedPrivateKeyLengths: "array",
      wrapPrivateKey: "boolean",
      isTorsionFree: "function",
      clearCofactor: "function",
      allowInfinityPoint: "boolean",
      fromBytes: "function",
      toBytes: "function"
    });
    const { endo, Fp: Fp4, a } = opts;
    if (endo) {
      if (!Fp4.eql(a, Fp4.ZERO)) {
        throw new Error("invalid endomorphism, can only be defined for Koblitz curves that have a=0");
      }
      if (typeof endo !== "object" || typeof endo.beta !== "bigint" || typeof endo.splitScalar !== "function") {
        throw new Error("invalid endomorphism, expected beta: bigint and splitScalar: function");
      }
    }
    return Object.freeze({ ...opts });
  }
  function weierstrassPoints(opts) {
    const CURVE = validatePointOpts(opts);
    const { Fp: Fp4 } = CURVE;
    const Fn = Field(CURVE.n, CURVE.nBitLength);
    const toBytes2 = CURVE.toBytes || ((_c, point, _isCompressed) => {
      const a = point.toAffine();
      return concatBytes(Uint8Array.from([4]), Fp4.toBytes(a.x), Fp4.toBytes(a.y));
    });
    const fromBytes = CURVE.fromBytes || ((bytes) => {
      const tail = bytes.subarray(1);
      const x5 = Fp4.fromBytes(tail.subarray(0, Fp4.BYTES));
      const y = Fp4.fromBytes(tail.subarray(Fp4.BYTES, 2 * Fp4.BYTES));
      return { x: x5, y };
    });
    function weierstrassEquation(x5) {
      const { a, b: b3 } = CURVE;
      const x22 = Fp4.sqr(x5);
      const x32 = Fp4.mul(x22, x5);
      return Fp4.add(Fp4.add(x32, Fp4.mul(x5, a)), b3);
    }
    if (!Fp4.eql(Fp4.sqr(CURVE.Gy), weierstrassEquation(CURVE.Gx)))
      throw new Error("bad generator point: equation left != right");
    function isWithinCurveOrder(num) {
      return inRange(num, _1n4, CURVE.n);
    }
    function normPrivateKeyToScalar(key) {
      const { allowedPrivateKeyLengths: lengths, nByteLength, wrapPrivateKey, n: N2 } = CURVE;
      if (lengths && typeof key !== "bigint") {
        if (isBytes2(key))
          key = bytesToHex(key);
        if (typeof key !== "string" || !lengths.includes(key.length))
          throw new Error("invalid private key");
        key = key.padStart(nByteLength * 2, "0");
      }
      let num;
      try {
        num = typeof key === "bigint" ? key : bytesToNumberBE(ensureBytes("private key", key, nByteLength));
      } catch (error) {
        throw new Error("invalid private key, expected hex or " + nByteLength + " bytes, got " + typeof key);
      }
      if (wrapPrivateKey)
        num = mod(num, N2);
      aInRange("private key", num, _1n4, N2);
      return num;
    }
    function assertPrjPoint(other) {
      if (!(other instanceof Point))
        throw new Error("ProjectivePoint expected");
    }
    const toAffineMemo = memoized((p3, iz) => {
      const { px: x5, py: y, pz: z } = p3;
      if (Fp4.eql(z, Fp4.ONE))
        return { x: x5, y };
      const is0 = p3.is0();
      if (iz == null)
        iz = is0 ? Fp4.ONE : Fp4.inv(z);
      const ax = Fp4.mul(x5, iz);
      const ay = Fp4.mul(y, iz);
      const zz = Fp4.mul(z, iz);
      if (is0)
        return { x: Fp4.ZERO, y: Fp4.ZERO };
      if (!Fp4.eql(zz, Fp4.ONE))
        throw new Error("invZ was invalid");
      return { x: ax, y: ay };
    });
    const assertValidMemo = memoized((p3) => {
      if (p3.is0()) {
        if (CURVE.allowInfinityPoint && !Fp4.is0(p3.py))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x: x5, y } = p3.toAffine();
      if (!Fp4.isValid(x5) || !Fp4.isValid(y))
        throw new Error("bad point: x or y not FE");
      const left = Fp4.sqr(y);
      const right = weierstrassEquation(x5);
      if (!Fp4.eql(left, right))
        throw new Error("bad point: equation left != right");
      if (!p3.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      return true;
    });
    class Point {
      constructor(px, py, pz) {
        this.px = px;
        this.py = py;
        this.pz = pz;
        if (px == null || !Fp4.isValid(px))
          throw new Error("x required");
        if (py == null || !Fp4.isValid(py))
          throw new Error("y required");
        if (pz == null || !Fp4.isValid(pz))
          throw new Error("z required");
        Object.freeze(this);
      }
      // Does not validate if the point is on-curve.
      // Use fromHex instead, or call assertValidity() later.
      static fromAffine(p3) {
        const { x: x5, y } = p3 || {};
        if (!p3 || !Fp4.isValid(x5) || !Fp4.isValid(y))
          throw new Error("invalid affine point");
        if (p3 instanceof Point)
          throw new Error("projective point not allowed");
        const is0 = (i) => Fp4.eql(i, Fp4.ZERO);
        if (is0(x5) && is0(y))
          return Point.ZERO;
        return new Point(x5, y, Fp4.ONE);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      /**
       * Takes a bunch of Projective Points but executes only one
       * inversion on all of them. Inversion is very slow operation,
       * so this improves performance massively.
       * Optimization: converts a list of projective points to a list of identical points with Z=1.
       */
      static normalizeZ(points) {
        const toInv = Fp4.invertBatch(points.map((p3) => p3.pz));
        return points.map((p3, i) => p3.toAffine(toInv[i])).map(Point.fromAffine);
      }
      /**
       * Converts hash string or Uint8Array to Point.
       * @param hex short/long ECDSA hex
       */
      static fromHex(hex) {
        const P2 = Point.fromAffine(fromBytes(ensureBytes("pointHex", hex)));
        P2.assertValidity();
        return P2;
      }
      // Multiplies generator point by privateKey.
      static fromPrivateKey(privateKey) {
        return Point.BASE.multiply(normPrivateKeyToScalar(privateKey));
      }
      // Multiscalar Multiplication
      static msm(points, scalars) {
        return pippenger(Point, Fn, points, scalars);
      }
      // "Private method", don't use it directly
      _setWindowSize(windowSize) {
        wnaf.setWindowSize(this, windowSize);
      }
      // A point on curve is valid if it conforms to equation.
      assertValidity() {
        assertValidMemo(this);
      }
      hasEvenY() {
        const { y } = this.toAffine();
        if (Fp4.isOdd)
          return !Fp4.isOdd(y);
        throw new Error("Field doesn't support isOdd");
      }
      /**
       * Compare one point to another.
       */
      equals(other) {
        assertPrjPoint(other);
        const { px: X1, py: Y1, pz: Z1 } = this;
        const { px: X2, py: Y2, pz: Z2 } = other;
        const U1 = Fp4.eql(Fp4.mul(X1, Z2), Fp4.mul(X2, Z1));
        const U22 = Fp4.eql(Fp4.mul(Y1, Z2), Fp4.mul(Y2, Z1));
        return U1 && U22;
      }
      /**
       * Flips point to one corresponding to (x, -y) in Affine coordinates.
       */
      negate() {
        return new Point(this.px, Fp4.neg(this.py), this.pz);
      }
      // Renes-Costello-Batina exception-free doubling formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 3
      // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
      double() {
        const { a, b: b3 } = CURVE;
        const b32 = Fp4.mul(b3, _3n2);
        const { px: X1, py: Y1, pz: Z1 } = this;
        let X3 = Fp4.ZERO, Y3 = Fp4.ZERO, Z3 = Fp4.ZERO;
        let t0 = Fp4.mul(X1, X1);
        let t1 = Fp4.mul(Y1, Y1);
        let t2 = Fp4.mul(Z1, Z1);
        let t3 = Fp4.mul(X1, Y1);
        t3 = Fp4.add(t3, t3);
        Z3 = Fp4.mul(X1, Z1);
        Z3 = Fp4.add(Z3, Z3);
        X3 = Fp4.mul(a, Z3);
        Y3 = Fp4.mul(b32, t2);
        Y3 = Fp4.add(X3, Y3);
        X3 = Fp4.sub(t1, Y3);
        Y3 = Fp4.add(t1, Y3);
        Y3 = Fp4.mul(X3, Y3);
        X3 = Fp4.mul(t3, X3);
        Z3 = Fp4.mul(b32, Z3);
        t2 = Fp4.mul(a, t2);
        t3 = Fp4.sub(t0, t2);
        t3 = Fp4.mul(a, t3);
        t3 = Fp4.add(t3, Z3);
        Z3 = Fp4.add(t0, t0);
        t0 = Fp4.add(Z3, t0);
        t0 = Fp4.add(t0, t2);
        t0 = Fp4.mul(t0, t3);
        Y3 = Fp4.add(Y3, t0);
        t2 = Fp4.mul(Y1, Z1);
        t2 = Fp4.add(t2, t2);
        t0 = Fp4.mul(t2, t3);
        X3 = Fp4.sub(X3, t0);
        Z3 = Fp4.mul(t2, t1);
        Z3 = Fp4.add(Z3, Z3);
        Z3 = Fp4.add(Z3, Z3);
        return new Point(X3, Y3, Z3);
      }
      // Renes-Costello-Batina exception-free addition formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 1
      // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
      add(other) {
        assertPrjPoint(other);
        const { px: X1, py: Y1, pz: Z1 } = this;
        const { px: X2, py: Y2, pz: Z2 } = other;
        let X3 = Fp4.ZERO, Y3 = Fp4.ZERO, Z3 = Fp4.ZERO;
        const a = CURVE.a;
        const b3 = Fp4.mul(CURVE.b, _3n2);
        let t0 = Fp4.mul(X1, X2);
        let t1 = Fp4.mul(Y1, Y2);
        let t2 = Fp4.mul(Z1, Z2);
        let t3 = Fp4.add(X1, Y1);
        let t4 = Fp4.add(X2, Y2);
        t3 = Fp4.mul(t3, t4);
        t4 = Fp4.add(t0, t1);
        t3 = Fp4.sub(t3, t4);
        t4 = Fp4.add(X1, Z1);
        let t5 = Fp4.add(X2, Z2);
        t4 = Fp4.mul(t4, t5);
        t5 = Fp4.add(t0, t2);
        t4 = Fp4.sub(t4, t5);
        t5 = Fp4.add(Y1, Z1);
        X3 = Fp4.add(Y2, Z2);
        t5 = Fp4.mul(t5, X3);
        X3 = Fp4.add(t1, t2);
        t5 = Fp4.sub(t5, X3);
        Z3 = Fp4.mul(a, t4);
        X3 = Fp4.mul(b3, t2);
        Z3 = Fp4.add(X3, Z3);
        X3 = Fp4.sub(t1, Z3);
        Z3 = Fp4.add(t1, Z3);
        Y3 = Fp4.mul(X3, Z3);
        t1 = Fp4.add(t0, t0);
        t1 = Fp4.add(t1, t0);
        t2 = Fp4.mul(a, t2);
        t4 = Fp4.mul(b3, t4);
        t1 = Fp4.add(t1, t2);
        t2 = Fp4.sub(t0, t2);
        t2 = Fp4.mul(a, t2);
        t4 = Fp4.add(t4, t2);
        t0 = Fp4.mul(t1, t4);
        Y3 = Fp4.add(Y3, t0);
        t0 = Fp4.mul(t5, t4);
        X3 = Fp4.mul(t3, X3);
        X3 = Fp4.sub(X3, t0);
        t0 = Fp4.mul(t3, t1);
        Z3 = Fp4.mul(t5, Z3);
        Z3 = Fp4.add(Z3, t0);
        return new Point(X3, Y3, Z3);
      }
      subtract(other) {
        return this.add(other.negate());
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      wNAF(n2) {
        return wnaf.wNAFCached(this, n2, Point.normalizeZ);
      }
      /**
       * Non-constant-time multiplication. Uses double-and-add algorithm.
       * It's faster, but should only be used when you don't care about
       * an exposed private key e.g. sig verification, which works over *public* keys.
       */
      multiplyUnsafe(sc) {
        const { endo, n: N2 } = CURVE;
        aInRange("scalar", sc, _0n4, N2);
        const I2 = Point.ZERO;
        if (sc === _0n4)
          return I2;
        if (this.is0() || sc === _1n4)
          return this;
        if (!endo || wnaf.hasPrecomputes(this))
          return wnaf.wNAFCachedUnsafe(this, sc, Point.normalizeZ);
        let { k1neg, k1, k2neg, k2 } = endo.splitScalar(sc);
        let k1p = I2;
        let k2p = I2;
        let d2 = this;
        while (k1 > _0n4 || k2 > _0n4) {
          if (k1 & _1n4)
            k1p = k1p.add(d2);
          if (k2 & _1n4)
            k2p = k2p.add(d2);
          d2 = d2.double();
          k1 >>= _1n4;
          k2 >>= _1n4;
        }
        if (k1neg)
          k1p = k1p.negate();
        if (k2neg)
          k2p = k2p.negate();
        k2p = new Point(Fp4.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
        return k1p.add(k2p);
      }
      /**
       * Constant time multiplication.
       * Uses wNAF method. Windowed method may be 10% faster,
       * but takes 2x longer to generate and consumes 2x memory.
       * Uses precomputes when available.
       * Uses endomorphism for Koblitz curves.
       * @param scalar by which the point would be multiplied
       * @returns New point
       */
      multiply(scalar) {
        const { endo, n: N2 } = CURVE;
        aInRange("scalar", scalar, _1n4, N2);
        let point, fake;
        if (endo) {
          const { k1neg, k1, k2neg, k2 } = endo.splitScalar(scalar);
          let { p: k1p, f: f1p } = this.wNAF(k1);
          let { p: k2p, f: f2p } = this.wNAF(k2);
          k1p = wnaf.constTimeNegate(k1neg, k1p);
          k2p = wnaf.constTimeNegate(k2neg, k2p);
          k2p = new Point(Fp4.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
          point = k1p.add(k2p);
          fake = f1p.add(f2p);
        } else {
          const { p: p3, f: f4 } = this.wNAF(scalar);
          point = p3;
          fake = f4;
        }
        return Point.normalizeZ([point, fake])[0];
      }
      /**
       * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
       * Not using Strauss-Shamir trick: precomputation tables are faster.
       * The trick could be useful if both P and Q are not G (not in our case).
       * @returns non-zero affine point
       */
      multiplyAndAddUnsafe(Q, a, b3) {
        const G2 = Point.BASE;
        const mul = (P2, a2) => a2 === _0n4 || a2 === _1n4 || !P2.equals(G2) ? P2.multiplyUnsafe(a2) : P2.multiply(a2);
        const sum = mul(this, a).add(mul(Q, b3));
        return sum.is0() ? void 0 : sum;
      }
      // Converts Projective point to affine (x, y) coordinates.
      // Can accept precomputed Z^-1 - for example, from invertBatch.
      // (x, y, z) ∋ (x=x/z, y=y/z)
      toAffine(iz) {
        return toAffineMemo(this, iz);
      }
      isTorsionFree() {
        const { h: cofactor, isTorsionFree } = CURVE;
        if (cofactor === _1n4)
          return true;
        if (isTorsionFree)
          return isTorsionFree(Point, this);
        throw new Error("isTorsionFree() has not been declared for the elliptic curve");
      }
      clearCofactor() {
        const { h: cofactor, clearCofactor } = CURVE;
        if (cofactor === _1n4)
          return this;
        if (clearCofactor)
          return clearCofactor(Point, this);
        return this.multiplyUnsafe(CURVE.h);
      }
      toRawBytes(isCompressed = true) {
        abool("isCompressed", isCompressed);
        this.assertValidity();
        return toBytes2(Point, this, isCompressed);
      }
      toHex(isCompressed = true) {
        abool("isCompressed", isCompressed);
        return bytesToHex(this.toRawBytes(isCompressed));
      }
    }
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp4.ONE);
    Point.ZERO = new Point(Fp4.ZERO, Fp4.ONE, Fp4.ZERO);
    const _bits = CURVE.nBitLength;
    const wnaf = wNAF(Point, CURVE.endo ? Math.ceil(_bits / 2) : _bits);
    return {
      CURVE,
      ProjectivePoint: Point,
      normPrivateKeyToScalar,
      weierstrassEquation,
      isWithinCurveOrder
    };
  }
  function SWUFpSqrtRatio(Fp4, Z) {
    const q = Fp4.ORDER;
    let l = _0n4;
    for (let o = q - _1n4; o % _2n3 === _0n4; o /= _2n3)
      l += _1n4;
    const c1 = l;
    const _2n_pow_c1_1 = _2n3 << c1 - _1n4 - _1n4;
    const _2n_pow_c1 = _2n_pow_c1_1 * _2n3;
    const c22 = (q - _1n4) / _2n_pow_c1;
    const c3 = (c22 - _1n4) / _2n3;
    const c4 = _2n_pow_c1 - _1n4;
    const c5 = _2n_pow_c1_1;
    const c6 = Fp4.pow(Z, c22);
    const c7 = Fp4.pow(Z, (c22 + _1n4) / _2n3);
    let sqrtRatio = (u2, v2) => {
      let tv1 = c6;
      let tv2 = Fp4.pow(v2, c4);
      let tv3 = Fp4.sqr(tv2);
      tv3 = Fp4.mul(tv3, v2);
      let tv5 = Fp4.mul(u2, tv3);
      tv5 = Fp4.pow(tv5, c3);
      tv5 = Fp4.mul(tv5, tv2);
      tv2 = Fp4.mul(tv5, v2);
      tv3 = Fp4.mul(tv5, u2);
      let tv4 = Fp4.mul(tv3, tv2);
      tv5 = Fp4.pow(tv4, c5);
      let isQR = Fp4.eql(tv5, Fp4.ONE);
      tv2 = Fp4.mul(tv3, c7);
      tv5 = Fp4.mul(tv4, tv1);
      tv3 = Fp4.cmov(tv2, tv3, isQR);
      tv4 = Fp4.cmov(tv5, tv4, isQR);
      for (let i = c1; i > _1n4; i--) {
        let tv52 = i - _2n3;
        tv52 = _2n3 << tv52 - _1n4;
        let tvv5 = Fp4.pow(tv4, tv52);
        const e1 = Fp4.eql(tvv5, Fp4.ONE);
        tv2 = Fp4.mul(tv3, tv1);
        tv1 = Fp4.mul(tv1, tv1);
        tvv5 = Fp4.mul(tv4, tv1);
        tv3 = Fp4.cmov(tv2, tv3, e1);
        tv4 = Fp4.cmov(tvv5, tv4, e1);
      }
      return { isValid: isQR, value: tv3 };
    };
    if (Fp4.ORDER % _4n2 === _3n2) {
      const c12 = (Fp4.ORDER - _3n2) / _4n2;
      const c23 = Fp4.sqrt(Fp4.neg(Z));
      sqrtRatio = (u2, v2) => {
        let tv1 = Fp4.sqr(v2);
        const tv2 = Fp4.mul(u2, v2);
        tv1 = Fp4.mul(tv1, tv2);
        let y1 = Fp4.pow(tv1, c12);
        y1 = Fp4.mul(y1, tv2);
        const y2 = Fp4.mul(y1, c23);
        const tv3 = Fp4.mul(Fp4.sqr(y1), v2);
        const isQR = Fp4.eql(tv3, u2);
        let y = Fp4.cmov(y2, y1, isQR);
        return { isValid: isQR, value: y };
      };
    }
    return sqrtRatio;
  }
  function mapToCurveSimpleSWU(Fp4, opts) {
    validateField(Fp4);
    if (!Fp4.isValid(opts.A) || !Fp4.isValid(opts.B) || !Fp4.isValid(opts.Z))
      throw new Error("mapToCurveSimpleSWU: invalid opts");
    const sqrtRatio = SWUFpSqrtRatio(Fp4, opts.Z);
    if (!Fp4.isOdd)
      throw new Error("Fp.isOdd is not implemented!");
    return (u2) => {
      let tv1, tv2, tv3, tv4, tv5, tv6, x5, y;
      tv1 = Fp4.sqr(u2);
      tv1 = Fp4.mul(tv1, opts.Z);
      tv2 = Fp4.sqr(tv1);
      tv2 = Fp4.add(tv2, tv1);
      tv3 = Fp4.add(tv2, Fp4.ONE);
      tv3 = Fp4.mul(tv3, opts.B);
      tv4 = Fp4.cmov(opts.Z, Fp4.neg(tv2), !Fp4.eql(tv2, Fp4.ZERO));
      tv4 = Fp4.mul(tv4, opts.A);
      tv2 = Fp4.sqr(tv3);
      tv6 = Fp4.sqr(tv4);
      tv5 = Fp4.mul(tv6, opts.A);
      tv2 = Fp4.add(tv2, tv5);
      tv2 = Fp4.mul(tv2, tv3);
      tv6 = Fp4.mul(tv6, tv4);
      tv5 = Fp4.mul(tv6, opts.B);
      tv2 = Fp4.add(tv2, tv5);
      x5 = Fp4.mul(tv1, tv3);
      const { isValid, value: value4 } = sqrtRatio(tv2, tv6);
      y = Fp4.mul(tv1, u2);
      y = Fp4.mul(y, value4);
      x5 = Fp4.cmov(x5, tv3, isValid);
      y = Fp4.cmov(y, value4, isValid);
      const e1 = Fp4.isOdd(u2) === Fp4.isOdd(y);
      y = Fp4.cmov(Fp4.neg(y), y, e1);
      x5 = Fp4.div(x5, tv4);
      return { x: x5, y };
    };
  }
  var b2n, h2b, _0n4, _1n4, _2n3, _3n2, _4n2;
  var init_weierstrass = __esm({
    "node_modules/@noble/curves/esm/abstract/weierstrass.js"() {
      init_curve();
      init_modular();
      init_utils2();
      init_utils2();
      ({ bytesToNumberBE: b2n, hexToBytes: h2b } = utils_exports);
      _0n4 = BigInt(0);
      _1n4 = BigInt(1);
      _2n3 = BigInt(2);
      _3n2 = BigInt(3);
      _4n2 = BigInt(4);
    }
  });

  // node_modules/@noble/curves/esm/abstract/bls.js
  function NAfDecomposition(a) {
    const res = [];
    for (; a > _1n5; a >>= _1n5) {
      if ((a & _1n5) === _0n5)
        res.unshift(0);
      else if ((a & _3n3) === _3n3) {
        res.unshift(-1);
        a += _1n5;
      } else
        res.unshift(1);
    }
    return res;
  }
  function bls(CURVE) {
    const { Fp: Fp4, Fr: Fr2, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 } = CURVE.fields;
    const BLS_X_IS_NEGATIVE = CURVE.params.xNegative;
    const TWIST = CURVE.params.twistType;
    const G1_ = weierstrassPoints({ n: Fr2.ORDER, ...CURVE.G1 });
    const G1 = Object.assign(G1_, createHasher(G1_.ProjectivePoint, CURVE.G1.mapToCurve, {
      ...CURVE.htfDefaults,
      ...CURVE.G1.htfDefaults
    }));
    const G2_ = weierstrassPoints({ n: Fr2.ORDER, ...CURVE.G2 });
    const G2 = Object.assign(G2_, createHasher(G2_.ProjectivePoint, CURVE.G2.mapToCurve, {
      ...CURVE.htfDefaults,
      ...CURVE.G2.htfDefaults
    }));
    let lineFunction;
    if (TWIST === "multiplicative") {
      lineFunction = (c0, c1, c22, f4, Px, Py) => Fp122.mul014(f4, c0, Fp22.mul(c1, Px), Fp22.mul(c22, Py));
    } else if (TWIST === "divisive") {
      lineFunction = (c0, c1, c22, f4, Px, Py) => Fp122.mul034(f4, Fp22.mul(c22, Py), Fp22.mul(c1, Px), c0);
    } else
      throw new Error("bls: unknown twist type");
    const Fp2div2 = Fp22.div(Fp22.ONE, Fp22.mul(Fp22.ONE, _2n4));
    function pointDouble(ell, Rx, Ry, Rz) {
      const t0 = Fp22.sqr(Ry);
      const t1 = Fp22.sqr(Rz);
      const t2 = Fp22.mulByB(Fp22.mul(t1, _3n3));
      const t3 = Fp22.mul(t2, _3n3);
      const t4 = Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(Ry, Rz)), t1), t0);
      const c0 = Fp22.sub(t2, t0);
      const c1 = Fp22.mul(Fp22.sqr(Rx), _3n3);
      const c22 = Fp22.neg(t4);
      ell.push([c0, c1, c22]);
      Rx = Fp22.mul(Fp22.mul(Fp22.mul(Fp22.sub(t0, t3), Rx), Ry), Fp2div2);
      Ry = Fp22.sub(Fp22.sqr(Fp22.mul(Fp22.add(t0, t3), Fp2div2)), Fp22.mul(Fp22.sqr(t2), _3n3));
      Rz = Fp22.mul(t0, t4);
      return { Rx, Ry, Rz };
    }
    function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
      const t0 = Fp22.sub(Ry, Fp22.mul(Qy, Rz));
      const t1 = Fp22.sub(Rx, Fp22.mul(Qx, Rz));
      const c0 = Fp22.sub(Fp22.mul(t0, Qx), Fp22.mul(t1, Qy));
      const c1 = Fp22.neg(t0);
      const c22 = t1;
      ell.push([c0, c1, c22]);
      const t2 = Fp22.sqr(t1);
      const t3 = Fp22.mul(t2, t1);
      const t4 = Fp22.mul(t2, Rx);
      const t5 = Fp22.add(Fp22.sub(t3, Fp22.mul(t4, _2n4)), Fp22.mul(Fp22.sqr(t0), Rz));
      Rx = Fp22.mul(t1, t5);
      Ry = Fp22.sub(Fp22.mul(Fp22.sub(t4, t5), t0), Fp22.mul(t3, Ry));
      Rz = Fp22.mul(Rz, t3);
      return { Rx, Ry, Rz };
    }
    const ATE_NAF = NAfDecomposition(CURVE.params.ateLoopSize);
    const calcPairingPrecomputes = memoized((point) => {
      const p3 = point;
      const { x: x5, y } = p3.toAffine();
      const Qx = x5, Qy = y, negQy = Fp22.neg(y);
      let Rx = Qx, Ry = Qy, Rz = Fp22.ONE;
      const ell = [];
      for (const bit of ATE_NAF) {
        const cur = [];
        ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
        if (bit)
          ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
        ell.push(cur);
      }
      if (CURVE.postPrecompute) {
        const last = ell[ell.length - 1];
        CURVE.postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
      }
      return ell;
    });
    function millerLoopBatch(pairs, withFinalExponent = false) {
      let f12 = Fp122.ONE;
      if (pairs.length) {
        const ellLen = pairs[0][0].length;
        for (let i = 0; i < ellLen; i++) {
          f12 = Fp122.sqr(f12);
          for (const [ell, Px, Py] of pairs) {
            for (const [c0, c1, c22] of ell[i])
              f12 = lineFunction(c0, c1, c22, f12, Px, Py);
          }
        }
      }
      if (BLS_X_IS_NEGATIVE)
        f12 = Fp122.conjugate(f12);
      return withFinalExponent ? Fp122.finalExponentiate(f12) : f12;
    }
    function pairingBatch(pairs, withFinalExponent = true) {
      const res = [];
      G1.ProjectivePoint.normalizeZ(pairs.map(({ g1 }) => g1));
      G2.ProjectivePoint.normalizeZ(pairs.map(({ g2: g22 }) => g22));
      for (const { g1, g2: g22 } of pairs) {
        if (g1.equals(G1.ProjectivePoint.ZERO) || g22.equals(G2.ProjectivePoint.ZERO))
          throw new Error("pairing is not available for ZERO point");
        g1.assertValidity();
        g22.assertValidity();
        const Qa = g1.toAffine();
        res.push([calcPairingPrecomputes(g22), Qa.x, Qa.y]);
      }
      return millerLoopBatch(res, withFinalExponent);
    }
    function pairing(Q, P2, withFinalExponent = true) {
      return pairingBatch([{ g1: Q, g2: P2 }], withFinalExponent);
    }
    const utils = {
      randomPrivateKey: () => {
        const length = getMinHashLength(Fr2.ORDER);
        return mapHashToField(CURVE.randomBytes(length), Fr2.ORDER);
      },
      calcPairingPrecomputes
    };
    const { ShortSignature } = CURVE.G1;
    const { Signature } = CURVE.G2;
    function normP1(point) {
      return point instanceof G1.ProjectivePoint ? point : G1.ProjectivePoint.fromHex(point);
    }
    function normP1Hash(point, htfOpts) {
      return point instanceof G1.ProjectivePoint ? point : G1.hashToCurve(ensureBytes("point", point), htfOpts);
    }
    function normP2(point) {
      return point instanceof G2.ProjectivePoint ? point : Signature.fromHex(point);
    }
    function normP2Hash(point, htfOpts) {
      return point instanceof G2.ProjectivePoint ? point : G2.hashToCurve(ensureBytes("point", point), htfOpts);
    }
    function getPublicKey(privateKey) {
      return G1.ProjectivePoint.fromPrivateKey(privateKey).toRawBytes(true);
    }
    function getPublicKeyForShortSignatures(privateKey) {
      return G2.ProjectivePoint.fromPrivateKey(privateKey).toRawBytes(true);
    }
    function sign(message, privateKey, htfOpts) {
      const msgPoint = normP2Hash(message, htfOpts);
      msgPoint.assertValidity();
      const sigPoint = msgPoint.multiply(G1.normPrivateKeyToScalar(privateKey));
      if (message instanceof G2.ProjectivePoint)
        return sigPoint;
      return Signature.toRawBytes(sigPoint);
    }
    function signShortSignature(message, privateKey, htfOpts) {
      const msgPoint = normP1Hash(message, htfOpts);
      msgPoint.assertValidity();
      const sigPoint = msgPoint.multiply(G1.normPrivateKeyToScalar(privateKey));
      if (message instanceof G1.ProjectivePoint)
        return sigPoint;
      return ShortSignature.toRawBytes(sigPoint);
    }
    function verify(signature, message, publicKey, htfOpts) {
      const P2 = normP1(publicKey);
      const Hm = normP2Hash(message, htfOpts);
      const G3 = G1.ProjectivePoint.BASE;
      const S2 = normP2(signature);
      const exp = pairingBatch([
        { g1: P2.negate(), g2: Hm },
        // ePHM = pairing(P.negate(), Hm, false);
        { g1: G3, g2: S2 }
        // eGS = pairing(G, S, false);
      ]);
      return Fp122.eql(exp, Fp122.ONE);
    }
    function verifyShortSignature(signature, message, publicKey, htfOpts) {
      const P2 = normP2(publicKey);
      const Hm = normP1Hash(message, htfOpts);
      const G3 = G2.ProjectivePoint.BASE;
      const S2 = normP1(signature);
      const exp = pairingBatch([
        { g1: Hm, g2: P2 },
        // eHmP = pairing(Hm, P, false);
        { g1: S2, g2: G3.negate() }
        // eSG = pairing(S, G.negate(), false);
      ]);
      return Fp122.eql(exp, Fp122.ONE);
    }
    function aNonEmpty(arr) {
      if (!Array.isArray(arr) || arr.length === 0)
        throw new Error("expected non-empty array");
    }
    function aggregatePublicKeys(publicKeys) {
      aNonEmpty(publicKeys);
      const agg = publicKeys.map(normP1).reduce((sum, p3) => sum.add(p3), G1.ProjectivePoint.ZERO);
      const aggAffine = agg;
      if (publicKeys[0] instanceof G1.ProjectivePoint) {
        aggAffine.assertValidity();
        return aggAffine;
      }
      return aggAffine.toRawBytes(true);
    }
    function aggregateSignatures(signatures) {
      aNonEmpty(signatures);
      const agg = signatures.map(normP2).reduce((sum, s2) => sum.add(s2), G2.ProjectivePoint.ZERO);
      const aggAffine = agg;
      if (signatures[0] instanceof G2.ProjectivePoint) {
        aggAffine.assertValidity();
        return aggAffine;
      }
      return Signature.toRawBytes(aggAffine);
    }
    function aggregateShortSignatures(signatures) {
      aNonEmpty(signatures);
      const agg = signatures.map(normP1).reduce((sum, s2) => sum.add(s2), G1.ProjectivePoint.ZERO);
      const aggAffine = agg;
      if (signatures[0] instanceof G1.ProjectivePoint) {
        aggAffine.assertValidity();
        return aggAffine;
      }
      return ShortSignature.toRawBytes(aggAffine);
    }
    function verifyBatch(signature, messages, publicKeys, htfOpts) {
      aNonEmpty(messages);
      if (publicKeys.length !== messages.length)
        throw new Error("amount of public keys and messages should be equal");
      const sig = normP2(signature);
      const nMessages = messages.map((i) => normP2Hash(i, htfOpts));
      const nPublicKeys = publicKeys.map(normP1);
      const messagePubKeyMap = /* @__PURE__ */ new Map();
      for (let i = 0; i < nPublicKeys.length; i++) {
        const pub = nPublicKeys[i];
        const msg = nMessages[i];
        let keys = messagePubKeyMap.get(msg);
        if (keys === void 0) {
          keys = [];
          messagePubKeyMap.set(msg, keys);
        }
        keys.push(pub);
      }
      const paired = [];
      try {
        for (const [msg, keys] of messagePubKeyMap) {
          const groupPublicKey = keys.reduce((acc, msg2) => acc.add(msg2));
          paired.push({ g1: groupPublicKey, g2: msg });
        }
        paired.push({ g1: G1.ProjectivePoint.BASE.negate(), g2: sig });
        return Fp122.eql(pairingBatch(paired), Fp122.ONE);
      } catch {
        return false;
      }
    }
    G1.ProjectivePoint.BASE._setWindowSize(4);
    return {
      getPublicKey,
      getPublicKeyForShortSignatures,
      sign,
      signShortSignature,
      verify,
      verifyBatch,
      verifyShortSignature,
      aggregatePublicKeys,
      aggregateSignatures,
      aggregateShortSignatures,
      millerLoopBatch,
      pairing,
      pairingBatch,
      G1,
      G2,
      Signature,
      ShortSignature,
      fields: {
        Fr: Fr2,
        Fp: Fp4,
        Fp2: Fp22,
        Fp6: Fp62,
        Fp12: Fp122
      },
      params: {
        ateLoopSize: CURVE.params.ateLoopSize,
        r: CURVE.params.r,
        G1b: CURVE.G1.b,
        G2b: CURVE.G2.b
      },
      utils
    };
  }
  var _0n5, _1n5, _2n4, _3n3;
  var init_bls = __esm({
    "node_modules/@noble/curves/esm/abstract/bls.js"() {
      init_modular();
      init_utils2();
      init_hash_to_curve();
      init_weierstrass();
      _0n5 = BigInt(0);
      _1n5 = BigInt(1);
      _2n4 = BigInt(2);
      _3n3 = BigInt(3);
    }
  });

  // node_modules/@noble/curves/esm/abstract/tower.js
  function calcFrobeniusCoefficients(Fp4, nonResidue, modulus, degree, num = 1, divisor) {
    const _divisor = BigInt(divisor === void 0 ? degree : divisor);
    const towerModulus = modulus ** BigInt(degree);
    const res = [];
    for (let i = 0; i < num; i++) {
      const a = BigInt(i + 1);
      const powers = [];
      for (let j2 = 0, qPower = _1n6; j2 < degree; j2++) {
        const power = (a * qPower - a) / _divisor % towerModulus;
        powers.push(Fp4.pow(nonResidue, power));
        qPower *= modulus;
      }
      res.push(powers);
    }
    return res;
  }
  function psiFrobenius(Fp4, Fp22, base) {
    const PSI_X = Fp22.pow(base, (Fp4.ORDER - _1n6) / _3n4);
    const PSI_Y = Fp22.pow(base, (Fp4.ORDER - _1n6) / _2n5);
    function psi(x5, y) {
      const x22 = Fp22.mul(Fp22.frobeniusMap(x5, 1), PSI_X);
      const y2 = Fp22.mul(Fp22.frobeniusMap(y, 1), PSI_Y);
      return [x22, y2];
    }
    const PSI2_X = Fp22.pow(base, (Fp4.ORDER ** _2n5 - _1n6) / _3n4);
    const PSI2_Y = Fp22.pow(base, (Fp4.ORDER ** _2n5 - _1n6) / _2n5);
    if (!Fp22.eql(PSI2_Y, Fp22.neg(Fp22.ONE)))
      throw new Error("psiFrobenius: PSI2_Y!==-1");
    function psi2(x5, y) {
      return [Fp22.mul(x5, PSI2_X), Fp22.neg(y)];
    }
    const mapAffine = (fn) => (c3, P2) => {
      const affine = P2.toAffine();
      const p3 = fn(affine.x, affine.y);
      return c3.fromAffine({ x: p3[0], y: p3[1] });
    };
    const G2psi3 = mapAffine(psi);
    const G2psi22 = mapAffine(psi2);
    return { psi, psi2, G2psi: G2psi3, G2psi2: G2psi22, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
  }
  function tower12(opts) {
    const { ORDER } = opts;
    const Fp4 = Field(ORDER);
    const FpNONRESIDUE = Fp4.create(opts.NONRESIDUE || BigInt(-1));
    const FpLegendre2 = FpLegendre(ORDER);
    const Fpdiv2 = Fp4.div(Fp4.ONE, _2n5);
    const FP2_FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp4, FpNONRESIDUE, Fp4.ORDER, 2)[0];
    const Fp2Add = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
      c0: Fp4.add(c0, r0),
      c1: Fp4.add(c1, r1)
    });
    const Fp2Subtract = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
      c0: Fp4.sub(c0, r0),
      c1: Fp4.sub(c1, r1)
    });
    const Fp2Multiply = ({ c0, c1 }, rhs) => {
      if (typeof rhs === "bigint")
        return { c0: Fp4.mul(c0, rhs), c1: Fp4.mul(c1, rhs) };
      const { c0: r0, c1: r1 } = rhs;
      let t1 = Fp4.mul(c0, r0);
      let t2 = Fp4.mul(c1, r1);
      const o0 = Fp4.sub(t1, t2);
      const o1 = Fp4.sub(Fp4.mul(Fp4.add(c0, c1), Fp4.add(r0, r1)), Fp4.add(t1, t2));
      return { c0: o0, c1: o1 };
    };
    const Fp2Square = ({ c0, c1 }) => {
      const a = Fp4.add(c0, c1);
      const b3 = Fp4.sub(c0, c1);
      const c3 = Fp4.add(c0, c0);
      return { c0: Fp4.mul(a, b3), c1: Fp4.mul(c3, c1) };
    };
    const Fp2fromBigTuple = (tuple) => {
      if (tuple.length !== 2)
        throw new Error("invalid tuple");
      const fps = tuple.map((n2) => Fp4.create(n2));
      return { c0: fps[0], c1: fps[1] };
    };
    const FP2_ORDER = ORDER * ORDER;
    const Fp2Nonresidue = Fp2fromBigTuple(opts.FP2_NONRESIDUE);
    const Fp22 = {
      ORDER: FP2_ORDER,
      isLE: Fp4.isLE,
      NONRESIDUE: Fp2Nonresidue,
      BITS: bitLen(FP2_ORDER),
      BYTES: Math.ceil(bitLen(FP2_ORDER) / 8),
      MASK: bitMask(bitLen(FP2_ORDER)),
      ZERO: { c0: Fp4.ZERO, c1: Fp4.ZERO },
      ONE: { c0: Fp4.ONE, c1: Fp4.ZERO },
      create: (num) => num,
      isValid: ({ c0, c1 }) => typeof c0 === "bigint" && typeof c1 === "bigint",
      is0: ({ c0, c1 }) => Fp4.is0(c0) && Fp4.is0(c1),
      eql: ({ c0, c1 }, { c0: r0, c1: r1 }) => Fp4.eql(c0, r0) && Fp4.eql(c1, r1),
      neg: ({ c0, c1 }) => ({ c0: Fp4.neg(c0), c1: Fp4.neg(c1) }),
      pow: (num, power) => FpPow(Fp22, num, power),
      invertBatch: (nums) => FpInvertBatch(Fp22, nums),
      // Normalized
      add: Fp2Add,
      sub: Fp2Subtract,
      mul: Fp2Multiply,
      sqr: Fp2Square,
      // NonNormalized stuff
      addN: Fp2Add,
      subN: Fp2Subtract,
      mulN: Fp2Multiply,
      sqrN: Fp2Square,
      // Why inversion for bigint inside Fp instead of Fp2? it is even used in that context?
      div: (lhs, rhs) => Fp22.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp22.inv(rhs)),
      inv: ({ c0: a, c1: b3 }) => {
        const factor = Fp4.inv(Fp4.create(a * a + b3 * b3));
        return { c0: Fp4.mul(factor, Fp4.create(a)), c1: Fp4.mul(factor, Fp4.create(-b3)) };
      },
      sqrt: (num) => {
        if (opts.Fp2sqrt)
          return opts.Fp2sqrt(num);
        const { c0, c1 } = num;
        if (Fp4.is0(c1)) {
          if (Fp4.eql(FpLegendre2(Fp4, c0), Fp4.ONE))
            return Fp22.create({ c0: Fp4.sqrt(c0), c1: Fp4.ZERO });
          else
            return Fp22.create({ c0: Fp4.ZERO, c1: Fp4.sqrt(Fp4.div(c0, FpNONRESIDUE)) });
        }
        const a = Fp4.sqrt(Fp4.sub(Fp4.sqr(c0), Fp4.mul(Fp4.sqr(c1), FpNONRESIDUE)));
        let d2 = Fp4.mul(Fp4.add(a, c0), Fpdiv2);
        const legendre = FpLegendre2(Fp4, d2);
        if (!Fp4.is0(legendre) && !Fp4.eql(legendre, Fp4.ONE))
          d2 = Fp4.sub(d2, a);
        const a0 = Fp4.sqrt(d2);
        const candidateSqrt = Fp22.create({ c0: a0, c1: Fp4.div(Fp4.mul(c1, Fpdiv2), a0) });
        if (!Fp22.eql(Fp22.sqr(candidateSqrt), num))
          throw new Error("Cannot find square root");
        const x1 = candidateSqrt;
        const x22 = Fp22.neg(x1);
        const { re: re1, im: im1 } = Fp22.reim(x1);
        const { re: re2, im: im2 } = Fp22.reim(x22);
        if (im1 > im2 || im1 === im2 && re1 > re2)
          return x1;
        return x22;
      },
      // Same as sgn0_m_eq_2 in RFC 9380
      isOdd: (x5) => {
        const { re: x0, im: x1 } = Fp22.reim(x5);
        const sign_0 = x0 % _2n5;
        const zero_0 = x0 === _0n6;
        const sign_1 = x1 % _2n5;
        return BigInt(sign_0 || zero_0 && sign_1) == _1n6;
      },
      // Bytes util
      fromBytes(b3) {
        if (b3.length !== Fp22.BYTES)
          throw new Error("fromBytes invalid length=" + b3.length);
        return { c0: Fp4.fromBytes(b3.subarray(0, Fp4.BYTES)), c1: Fp4.fromBytes(b3.subarray(Fp4.BYTES)) };
      },
      toBytes: ({ c0, c1 }) => concatBytes(Fp4.toBytes(c0), Fp4.toBytes(c1)),
      cmov: ({ c0, c1 }, { c0: r0, c1: r1 }, c3) => ({
        c0: Fp4.cmov(c0, r0, c3),
        c1: Fp4.cmov(c1, r1, c3)
      }),
      reim: ({ c0, c1 }) => ({ re: c0, im: c1 }),
      // multiply by u + 1
      mulByNonresidue: ({ c0, c1 }) => Fp22.mul({ c0, c1 }, Fp2Nonresidue),
      mulByB: opts.Fp2mulByB,
      fromBigTuple: Fp2fromBigTuple,
      frobeniusMap: ({ c0, c1 }, power) => ({
        c0,
        c1: Fp4.mul(c1, FP2_FROBENIUS_COEFFICIENTS[power % 2])
      })
    };
    const Fp6Add = ({ c0, c1, c2: c22 }, { c0: r0, c1: r1, c2: r2 }) => ({
      c0: Fp22.add(c0, r0),
      c1: Fp22.add(c1, r1),
      c2: Fp22.add(c22, r2)
    });
    const Fp6Subtract = ({ c0, c1, c2: c22 }, { c0: r0, c1: r1, c2: r2 }) => ({
      c0: Fp22.sub(c0, r0),
      c1: Fp22.sub(c1, r1),
      c2: Fp22.sub(c22, r2)
    });
    const Fp6Multiply = ({ c0, c1, c2: c22 }, rhs) => {
      if (typeof rhs === "bigint") {
        return {
          c0: Fp22.mul(c0, rhs),
          c1: Fp22.mul(c1, rhs),
          c2: Fp22.mul(c22, rhs)
        };
      }
      const { c0: r0, c1: r1, c2: r2 } = rhs;
      const t0 = Fp22.mul(c0, r0);
      const t1 = Fp22.mul(c1, r1);
      const t2 = Fp22.mul(c22, r2);
      return {
        // t0 + (c1 + c2) * (r1 * r2) - (T1 + T2) * (u + 1)
        c0: Fp22.add(t0, Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c22), Fp22.add(r1, r2)), Fp22.add(t1, t2)))),
        // (c0 + c1) * (r0 + r1) - (T0 + T1) + T2 * (u + 1)
        c1: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c1), Fp22.add(r0, r1)), Fp22.add(t0, t1)), Fp22.mulByNonresidue(t2)),
        // T1 + (c0 + c2) * (r0 + r2) - T0 + T2
        c2: Fp22.sub(Fp22.add(t1, Fp22.mul(Fp22.add(c0, c22), Fp22.add(r0, r2))), Fp22.add(t0, t2))
      };
    };
    const Fp6Square = ({ c0, c1, c2: c22 }) => {
      let t0 = Fp22.sqr(c0);
      let t1 = Fp22.mul(Fp22.mul(c0, c1), _2n5);
      let t3 = Fp22.mul(Fp22.mul(c1, c22), _2n5);
      let t4 = Fp22.sqr(c22);
      return {
        c0: Fp22.add(Fp22.mulByNonresidue(t3), t0),
        // T3 * (u + 1) + T0
        c1: Fp22.add(Fp22.mulByNonresidue(t4), t1),
        // T4 * (u + 1) + T1
        // T1 + (c0 - c1 + c2)² + T3 - T0 - T4
        c2: Fp22.sub(Fp22.sub(Fp22.add(Fp22.add(t1, Fp22.sqr(Fp22.add(Fp22.sub(c0, c1), c22))), t3), t0), t4)
      };
    };
    const [FP6_FROBENIUS_COEFFICIENTS_1, FP6_FROBENIUS_COEFFICIENTS_2] = calcFrobeniusCoefficients(Fp22, Fp2Nonresidue, Fp4.ORDER, 6, 2, 3);
    const Fp62 = {
      ORDER: Fp22.ORDER,
      // TODO: unused, but need to verify
      isLE: Fp22.isLE,
      BITS: 3 * Fp22.BITS,
      BYTES: 3 * Fp22.BYTES,
      MASK: bitMask(3 * Fp22.BITS),
      ZERO: { c0: Fp22.ZERO, c1: Fp22.ZERO, c2: Fp22.ZERO },
      ONE: { c0: Fp22.ONE, c1: Fp22.ZERO, c2: Fp22.ZERO },
      create: (num) => num,
      isValid: ({ c0, c1, c2: c22 }) => Fp22.isValid(c0) && Fp22.isValid(c1) && Fp22.isValid(c22),
      is0: ({ c0, c1, c2: c22 }) => Fp22.is0(c0) && Fp22.is0(c1) && Fp22.is0(c22),
      neg: ({ c0, c1, c2: c22 }) => ({ c0: Fp22.neg(c0), c1: Fp22.neg(c1), c2: Fp22.neg(c22) }),
      eql: ({ c0, c1, c2: c22 }, { c0: r0, c1: r1, c2: r2 }) => Fp22.eql(c0, r0) && Fp22.eql(c1, r1) && Fp22.eql(c22, r2),
      sqrt: notImplemented,
      // Do we need division by bigint at all? Should be done via order:
      div: (lhs, rhs) => Fp62.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp62.inv(rhs)),
      pow: (num, power) => FpPow(Fp62, num, power),
      invertBatch: (nums) => FpInvertBatch(Fp62, nums),
      // Normalized
      add: Fp6Add,
      sub: Fp6Subtract,
      mul: Fp6Multiply,
      sqr: Fp6Square,
      // NonNormalized stuff
      addN: Fp6Add,
      subN: Fp6Subtract,
      mulN: Fp6Multiply,
      sqrN: Fp6Square,
      inv: ({ c0, c1, c2: c22 }) => {
        let t0 = Fp22.sub(Fp22.sqr(c0), Fp22.mulByNonresidue(Fp22.mul(c22, c1)));
        let t1 = Fp22.sub(Fp22.mulByNonresidue(Fp22.sqr(c22)), Fp22.mul(c0, c1));
        let t2 = Fp22.sub(Fp22.sqr(c1), Fp22.mul(c0, c22));
        let t4 = Fp22.inv(Fp22.add(Fp22.mulByNonresidue(Fp22.add(Fp22.mul(c22, t1), Fp22.mul(c1, t2))), Fp22.mul(c0, t0)));
        return { c0: Fp22.mul(t4, t0), c1: Fp22.mul(t4, t1), c2: Fp22.mul(t4, t2) };
      },
      // Bytes utils
      fromBytes: (b3) => {
        if (b3.length !== Fp62.BYTES)
          throw new Error("fromBytes invalid length=" + b3.length);
        return {
          c0: Fp22.fromBytes(b3.subarray(0, Fp22.BYTES)),
          c1: Fp22.fromBytes(b3.subarray(Fp22.BYTES, 2 * Fp22.BYTES)),
          c2: Fp22.fromBytes(b3.subarray(2 * Fp22.BYTES))
        };
      },
      toBytes: ({ c0, c1, c2: c22 }) => concatBytes(Fp22.toBytes(c0), Fp22.toBytes(c1), Fp22.toBytes(c22)),
      cmov: ({ c0, c1, c2: c22 }, { c0: r0, c1: r1, c2: r2 }, c3) => ({
        c0: Fp22.cmov(c0, r0, c3),
        c1: Fp22.cmov(c1, r1, c3),
        c2: Fp22.cmov(c22, r2, c3)
      }),
      fromBigSix: (t2) => {
        if (!Array.isArray(t2) || t2.length !== 6)
          throw new Error("invalid Fp6 usage");
        return {
          c0: Fp22.fromBigTuple(t2.slice(0, 2)),
          c1: Fp22.fromBigTuple(t2.slice(2, 4)),
          c2: Fp22.fromBigTuple(t2.slice(4, 6))
        };
      },
      frobeniusMap: ({ c0, c1, c2: c22 }, power) => ({
        c0: Fp22.frobeniusMap(c0, power),
        c1: Fp22.mul(Fp22.frobeniusMap(c1, power), FP6_FROBENIUS_COEFFICIENTS_1[power % 6]),
        c2: Fp22.mul(Fp22.frobeniusMap(c22, power), FP6_FROBENIUS_COEFFICIENTS_2[power % 6])
      }),
      mulByFp2: ({ c0, c1, c2: c22 }, rhs) => ({
        c0: Fp22.mul(c0, rhs),
        c1: Fp22.mul(c1, rhs),
        c2: Fp22.mul(c22, rhs)
      }),
      mulByNonresidue: ({ c0, c1, c2: c22 }) => ({ c0: Fp22.mulByNonresidue(c22), c1: c0, c2: c1 }),
      // Sparse multiplication
      mul1: ({ c0, c1, c2: c22 }, b1) => ({
        c0: Fp22.mulByNonresidue(Fp22.mul(c22, b1)),
        c1: Fp22.mul(c0, b1),
        c2: Fp22.mul(c1, b1)
      }),
      // Sparse multiplication
      mul01({ c0, c1, c2: c22 }, b0, b1) {
        let t0 = Fp22.mul(c0, b0);
        let t1 = Fp22.mul(c1, b1);
        return {
          // ((c1 + c2) * b1 - T1) * (u + 1) + T0
          c0: Fp22.add(Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c22), b1), t1)), t0),
          // (b0 + b1) * (c0 + c1) - T0 - T1
          c1: Fp22.sub(Fp22.sub(Fp22.mul(Fp22.add(b0, b1), Fp22.add(c0, c1)), t0), t1),
          // (c0 + c2) * b0 - T0 + T1
          c2: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c22), b0), t0), t1)
        };
      }
    };
    const FP12_FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp22, Fp2Nonresidue, Fp4.ORDER, 12, 1, 6)[0];
    const Fp12Add = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
      c0: Fp62.add(c0, r0),
      c1: Fp62.add(c1, r1)
    });
    const Fp12Subtract = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
      c0: Fp62.sub(c0, r0),
      c1: Fp62.sub(c1, r1)
    });
    const Fp12Multiply = ({ c0, c1 }, rhs) => {
      if (typeof rhs === "bigint")
        return { c0: Fp62.mul(c0, rhs), c1: Fp62.mul(c1, rhs) };
      let { c0: r0, c1: r1 } = rhs;
      let t1 = Fp62.mul(c0, r0);
      let t2 = Fp62.mul(c1, r1);
      return {
        c0: Fp62.add(t1, Fp62.mulByNonresidue(t2)),
        // T1 + T2 * v
        // (c0 + c1) * (r0 + r1) - (T1 + T2)
        c1: Fp62.sub(Fp62.mul(Fp62.add(c0, c1), Fp62.add(r0, r1)), Fp62.add(t1, t2))
      };
    };
    const Fp12Square = ({ c0, c1 }) => {
      let ab = Fp62.mul(c0, c1);
      return {
        // (c1 * v + c0) * (c0 + c1) - AB - AB * v
        c0: Fp62.sub(Fp62.sub(Fp62.mul(Fp62.add(Fp62.mulByNonresidue(c1), c0), Fp62.add(c0, c1)), ab), Fp62.mulByNonresidue(ab)),
        c1: Fp62.add(ab, ab)
      };
    };
    function Fp4Square2(a, b3) {
      const a2 = Fp22.sqr(a);
      const b22 = Fp22.sqr(b3);
      return {
        first: Fp22.add(Fp22.mulByNonresidue(b22), a2),
        // b² * Nonresidue + a²
        second: Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(a, b3)), a2), b22)
        // (a + b)² - a² - b²
      };
    }
    const Fp122 = {
      ORDER: Fp22.ORDER,
      // TODO: unused, but need to verify
      isLE: Fp62.isLE,
      BITS: 2 * Fp22.BITS,
      BYTES: 2 * Fp22.BYTES,
      MASK: bitMask(2 * Fp22.BITS),
      ZERO: { c0: Fp62.ZERO, c1: Fp62.ZERO },
      ONE: { c0: Fp62.ONE, c1: Fp62.ZERO },
      create: (num) => num,
      isValid: ({ c0, c1 }) => Fp62.isValid(c0) && Fp62.isValid(c1),
      is0: ({ c0, c1 }) => Fp62.is0(c0) && Fp62.is0(c1),
      neg: ({ c0, c1 }) => ({ c0: Fp62.neg(c0), c1: Fp62.neg(c1) }),
      eql: ({ c0, c1 }, { c0: r0, c1: r1 }) => Fp62.eql(c0, r0) && Fp62.eql(c1, r1),
      sqrt: notImplemented,
      inv: ({ c0, c1 }) => {
        let t2 = Fp62.inv(Fp62.sub(Fp62.sqr(c0), Fp62.mulByNonresidue(Fp62.sqr(c1))));
        return { c0: Fp62.mul(c0, t2), c1: Fp62.neg(Fp62.mul(c1, t2)) };
      },
      div: (lhs, rhs) => Fp122.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp122.inv(rhs)),
      pow: (num, power) => FpPow(Fp122, num, power),
      invertBatch: (nums) => FpInvertBatch(Fp122, nums),
      // Normalized
      add: Fp12Add,
      sub: Fp12Subtract,
      mul: Fp12Multiply,
      sqr: Fp12Square,
      // NonNormalized stuff
      addN: Fp12Add,
      subN: Fp12Subtract,
      mulN: Fp12Multiply,
      sqrN: Fp12Square,
      // Bytes utils
      fromBytes: (b3) => {
        if (b3.length !== Fp122.BYTES)
          throw new Error("fromBytes invalid length=" + b3.length);
        return {
          c0: Fp62.fromBytes(b3.subarray(0, Fp62.BYTES)),
          c1: Fp62.fromBytes(b3.subarray(Fp62.BYTES))
        };
      },
      toBytes: ({ c0, c1 }) => concatBytes(Fp62.toBytes(c0), Fp62.toBytes(c1)),
      cmov: ({ c0, c1 }, { c0: r0, c1: r1 }, c3) => ({
        c0: Fp62.cmov(c0, r0, c3),
        c1: Fp62.cmov(c1, r1, c3)
      }),
      // Utils
      // toString() {
      //   return '' + 'Fp12(' + this.c0 + this.c1 + '* w');
      // },
      // fromTuple(c: [Fp6, Fp6]) {
      //   return new Fp12(...c);
      // }
      fromBigTwelve: (t2) => ({
        c0: Fp62.fromBigSix(t2.slice(0, 6)),
        c1: Fp62.fromBigSix(t2.slice(6, 12))
      }),
      // Raises to q**i -th power
      frobeniusMap(lhs, power) {
        const { c0, c1, c2: c22 } = Fp62.frobeniusMap(lhs.c1, power);
        const coeff = FP12_FROBENIUS_COEFFICIENTS[power % 12];
        return {
          c0: Fp62.frobeniusMap(lhs.c0, power),
          c1: Fp62.create({
            c0: Fp22.mul(c0, coeff),
            c1: Fp22.mul(c1, coeff),
            c2: Fp22.mul(c22, coeff)
          })
        };
      },
      mulByFp2: ({ c0, c1 }, rhs) => ({
        c0: Fp62.mulByFp2(c0, rhs),
        c1: Fp62.mulByFp2(c1, rhs)
      }),
      conjugate: ({ c0, c1 }) => ({ c0, c1: Fp62.neg(c1) }),
      // Sparse multiplication
      mul014: ({ c0, c1 }, o0, o1, o4) => {
        let t0 = Fp62.mul01(c0, o0, o1);
        let t1 = Fp62.mul1(c1, o4);
        return {
          c0: Fp62.add(Fp62.mulByNonresidue(t1), t0),
          // T1 * v + T0
          // (c1 + c0) * [o0, o1+o4] - T0 - T1
          c1: Fp62.sub(Fp62.sub(Fp62.mul01(Fp62.add(c1, c0), o0, Fp22.add(o1, o4)), t0), t1)
        };
      },
      mul034: ({ c0, c1 }, o0, o3, o4) => {
        const a = Fp62.create({
          c0: Fp22.mul(c0.c0, o0),
          c1: Fp22.mul(c0.c1, o0),
          c2: Fp22.mul(c0.c2, o0)
        });
        const b3 = Fp62.mul01(c1, o3, o4);
        const e3 = Fp62.mul01(Fp62.add(c0, c1), Fp22.add(o0, o3), o4);
        return {
          c0: Fp62.add(Fp62.mulByNonresidue(b3), a),
          c1: Fp62.sub(e3, Fp62.add(a, b3))
        };
      },
      // A cyclotomic group is a subgroup of Fp^n defined by
      //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
      // The result of any pairing is in a cyclotomic subgroup
      // https://eprint.iacr.org/2009/565.pdf
      _cyclotomicSquare: opts.Fp12cyclotomicSquare,
      _cyclotomicExp: opts.Fp12cyclotomicExp,
      // https://eprint.iacr.org/2010/354.pdf
      // https://eprint.iacr.org/2009/565.pdf
      finalExponentiate: opts.Fp12finalExponentiate
    };
    return { Fp: Fp4, Fp2: Fp22, Fp6: Fp62, Fp4Square: Fp4Square2, Fp12: Fp122 };
  }
  var _0n6, _1n6, _2n5, _3n4;
  var init_tower = __esm({
    "node_modules/@noble/curves/esm/abstract/tower.js"() {
      init_modular();
      init_utils2();
      _0n6 = BigInt(0);
      _1n6 = BigInt(1);
      _2n5 = BigInt(2);
      _3n4 = BigInt(3);
    }
  });

  // node_modules/@noble/curves/esm/bls12-381.js
  function parseMask(bytes) {
    bytes = bytes.slice();
    const mask = bytes[0] & 224;
    const compressed = !!(mask >> 7 & 1);
    const infinity = !!(mask >> 6 & 1);
    const sort = !!(mask >> 5 & 1);
    bytes[0] &= 31;
    return { compressed, infinity, sort, value: bytes };
  }
  function setMask(bytes, mask) {
    if (bytes[0] & 224)
      throw new Error("setMask: non-empty mask");
    if (mask.compressed)
      bytes[0] |= 128;
    if (mask.infinity)
      bytes[0] |= 64;
    if (mask.sort)
      bytes[0] |= 32;
    return bytes;
  }
  function signatureG1ToRawBytes(point) {
    point.assertValidity();
    const isZero = point.equals(bls12_381.G1.ProjectivePoint.ZERO);
    const { x: x5, y } = point.toAffine();
    if (isZero)
      return COMPRESSED_ZERO.slice();
    const P2 = Fp.ORDER;
    const sort = Boolean(y * _2n6 / P2);
    return setMask(numberToBytesBE(x5, Fp.BYTES), { compressed: true, sort });
  }
  function signatureG2ToRawBytes(point) {
    point.assertValidity();
    const len = Fp.BYTES;
    if (point.equals(bls12_381.G2.ProjectivePoint.ZERO))
      return concatBytes(COMPRESSED_ZERO, numberToBytesBE(_0n7, len));
    const { x: x5, y } = point.toAffine();
    const { re: x0, im: x1 } = Fp2.reim(x5);
    const { re: y0, im: y1 } = Fp2.reim(y);
    const tmp = y1 > _0n7 ? y1 * _2n6 : y0 * _2n6;
    const sort = Boolean(tmp / Fp.ORDER & _1n7);
    const z2 = x0;
    return concatBytes(setMask(numberToBytesBE(x1, len), { sort, compressed: true }), numberToBytesBE(z2, len));
  }
  var _0n7, _1n7, _2n6, _3n5, _4n3, BLS_X, BLS_X_LEN, Fp, Fp2, Fp6, Fp4Square, Fp12, Fr, isogenyMapG2, isogenyMapG1, G2_SWU, G1_SWU, G2psi, G2psi2, htfDefaults, COMPRESSED_ZERO, bls12_381;
  var init_bls12_381 = __esm({
    "node_modules/@noble/curves/esm/bls12-381.js"() {
      init_sha256();
      init_utils();
      init_bls();
      init_modular();
      init_utils2();
      init_hash_to_curve();
      init_weierstrass();
      init_tower();
      _0n7 = BigInt(0);
      _1n7 = BigInt(1);
      _2n6 = BigInt(2);
      _3n5 = BigInt(3);
      _4n3 = BigInt(4);
      BLS_X = BigInt("0xd201000000010000");
      BLS_X_LEN = bitLen(BLS_X);
      ({ Fp, Fp2, Fp6, Fp4Square, Fp12 } = tower12({
        // Order of Fp
        ORDER: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
        // Finite extension field over irreducible polynominal.
        // Fp(u) / (u² - β) where β = -1
        FP2_NONRESIDUE: [_1n7, _1n7],
        Fp2mulByB: ({ c0, c1 }) => {
          const t0 = Fp.mul(c0, _4n3);
          const t1 = Fp.mul(c1, _4n3);
          return { c0: Fp.sub(t0, t1), c1: Fp.add(t0, t1) };
        },
        // Fp12
        // A cyclotomic group is a subgroup of Fp^n defined by
        //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
        // The result of any pairing is in a cyclotomic subgroup
        // https://eprint.iacr.org/2009/565.pdf
        Fp12cyclotomicSquare: ({ c0, c1 }) => {
          const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
          const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
          const { first: t3, second: t4 } = Fp4Square(c0c0, c1c1);
          const { first: t5, second: t6 } = Fp4Square(c1c0, c0c2);
          const { first: t7, second: t8 } = Fp4Square(c0c1, c1c2);
          const t9 = Fp2.mulByNonresidue(t8);
          return {
            c0: Fp6.create({
              c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n6), t3),
              // 2 * (T3 - c0c0)  + T3
              c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n6), t5),
              // 2 * (T5 - c0c1)  + T5
              c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n6), t7)
            }),
            // 2 * (T7 - c0c2)  + T7
            c1: Fp6.create({
              c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n6), t9),
              // 2 * (T9 + c1c0) + T9
              c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n6), t4),
              // 2 * (T4 + c1c1) + T4
              c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n6), t6)
            })
          };
        },
        Fp12cyclotomicExp(num, n2) {
          let z = Fp12.ONE;
          for (let i = BLS_X_LEN - 1; i >= 0; i--) {
            z = Fp12._cyclotomicSquare(z);
            if (bitGet(n2, i))
              z = Fp12.mul(z, num);
          }
          return z;
        },
        // https://eprint.iacr.org/2010/354.pdf
        // https://eprint.iacr.org/2009/565.pdf
        Fp12finalExponentiate: (num) => {
          const x5 = BLS_X;
          const t0 = Fp12.div(Fp12.frobeniusMap(num, 6), num);
          const t1 = Fp12.mul(Fp12.frobeniusMap(t0, 2), t0);
          const t2 = Fp12.conjugate(Fp12._cyclotomicExp(t1, x5));
          const t3 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicSquare(t1)), t2);
          const t4 = Fp12.conjugate(Fp12._cyclotomicExp(t3, x5));
          const t5 = Fp12.conjugate(Fp12._cyclotomicExp(t4, x5));
          const t6 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicExp(t5, x5)), Fp12._cyclotomicSquare(t2));
          const t7 = Fp12.conjugate(Fp12._cyclotomicExp(t6, x5));
          const t2_t5_pow_q2 = Fp12.frobeniusMap(Fp12.mul(t2, t5), 2);
          const t4_t1_pow_q3 = Fp12.frobeniusMap(Fp12.mul(t4, t1), 3);
          const t6_t1c_pow_q1 = Fp12.frobeniusMap(Fp12.mul(t6, Fp12.conjugate(t1)), 1);
          const t7_t3c_t1 = Fp12.mul(Fp12.mul(t7, Fp12.conjugate(t3)), t1);
          return Fp12.mul(Fp12.mul(Fp12.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
        }
      }));
      Fr = Field(BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"));
      isogenyMapG2 = isogenyMap(Fp2, [
        // xNum
        [
          [
            "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6",
            "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6"
          ],
          [
            "0x0",
            "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a"
          ],
          [
            "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e",
            "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d"
          ],
          [
            "0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1",
            "0x0"
          ]
        ],
        // xDen
        [
          [
            "0x0",
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63"
          ],
          [
            "0xc",
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f"
          ],
          ["0x1", "0x0"]
          // LAST 1
        ],
        // yNum
        [
          [
            "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706",
            "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706"
          ],
          [
            "0x0",
            "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be"
          ],
          [
            "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c",
            "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f"
          ],
          [
            "0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10",
            "0x0"
          ]
        ],
        // yDen
        [
          [
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb",
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb"
          ],
          [
            "0x0",
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3"
          ],
          [
            "0x12",
            "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99"
          ],
          ["0x1", "0x0"]
          // LAST 1
        ]
      ].map((i) => i.map((pair) => Fp2.fromBigTuple(pair.map(BigInt)))));
      isogenyMapG1 = isogenyMap(Fp, [
        // xNum
        [
          "0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7",
          "0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb",
          "0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0",
          "0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861",
          "0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9",
          "0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983",
          "0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84",
          "0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e",
          "0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317",
          "0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e",
          "0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b",
          "0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229"
        ],
        // xDen
        [
          "0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c",
          "0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff",
          "0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19",
          "0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8",
          "0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e",
          "0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5",
          "0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a",
          "0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e",
          "0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641",
          "0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a",
          "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
          // LAST 1
        ],
        // yNum
        [
          "0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33",
          "0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696",
          "0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6",
          "0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb",
          "0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb",
          "0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0",
          "0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2",
          "0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29",
          "0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587",
          "0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30",
          "0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132",
          "0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e",
          "0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8",
          "0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133",
          "0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b",
          "0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604"
        ],
        // yDen
        [
          "0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1",
          "0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d",
          "0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2",
          "0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416",
          "0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d",
          "0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac",
          "0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c",
          "0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9",
          "0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a",
          "0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55",
          "0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8",
          "0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092",
          "0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc",
          "0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7",
          "0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f",
          "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
          // LAST 1
        ]
      ].map((i) => i.map((j2) => BigInt(j2))));
      G2_SWU = mapToCurveSimpleSWU(Fp2, {
        A: Fp2.create({ c0: Fp.create(_0n7), c1: Fp.create(BigInt(240)) }),
        // A' = 240 * I
        B: Fp2.create({ c0: Fp.create(BigInt(1012)), c1: Fp.create(BigInt(1012)) }),
        // B' = 1012 * (1 + I)
        Z: Fp2.create({ c0: Fp.create(BigInt(-2)), c1: Fp.create(BigInt(-1)) })
        // Z: -(2 + I)
      });
      G1_SWU = mapToCurveSimpleSWU(Fp, {
        A: Fp.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
        B: Fp.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
        Z: Fp.create(BigInt(11))
      });
      ({ G2psi, G2psi2 } = psiFrobenius(Fp, Fp2, Fp2.div(Fp2.ONE, Fp2.NONRESIDUE)));
      htfDefaults = Object.freeze({
        // DST: a domain separation tag
        // defined in section 2.2.5
        // Use utils.getDSTLabel(), utils.setDSTLabel(value)
        DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
        encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
        // p: the characteristic of F
        //    where F is a finite field of characteristic p and order q = p^m
        p: Fp.ORDER,
        // m: the extension degree of F, m >= 1
        //     where F is a finite field of characteristic p and order q = p^m
        m: 2,
        // k: the target security level for the suite in bits
        // defined in section 5.1
        k: 128,
        // option to use a message that has already been processed by
        // expand_message_xmd
        expand: "xmd",
        // Hash functions for: expand_message_xmd is appropriate for use with a
        // wide range of hash functions, including SHA-2, SHA-3, BLAKE2, and others.
        // BBS+ uses blake2: https://github.com/hyperledger/aries-framework-go/issues/2247
        hash: sha256
      });
      COMPRESSED_ZERO = setMask(Fp.toBytes(_0n7), { infinity: true, compressed: true });
      bls12_381 = bls({
        // Fields
        fields: {
          Fp,
          Fp2,
          Fp6,
          Fp12,
          Fr
        },
        // G1 is the order-q subgroup of E1(Fp) : y² = x³ + 4, #E1(Fp) = h1q, where
        // characteristic; z + (z⁴ - z² + 1)(z - 1)²/3
        G1: {
          Fp,
          // cofactor; (z - 1)²/3
          h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
          // generator's coordinates
          // x = 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507
          // y = 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569
          Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
          Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1"),
          a: Fp.ZERO,
          b: _4n3,
          htfDefaults: { ...htfDefaults, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
          wrapPrivateKey: true,
          allowInfinityPoint: true,
          // Checks is the point resides in prime-order subgroup.
          // point.isTorsionFree() should return true for valid points
          // It returns false for shitty points.
          // https://eprint.iacr.org/2021/1130.pdf
          isTorsionFree: (c3, point) => {
            const cubicRootOfUnityModP = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
            const phi = new c3(Fp.mul(point.px, cubicRootOfUnityModP), point.py, point.pz);
            const xP = point.multiplyUnsafe(BLS_X).negate();
            const u2P = xP.multiplyUnsafe(BLS_X);
            return u2P.equals(phi);
          },
          // Clear cofactor of G1
          // https://eprint.iacr.org/2019/403
          clearCofactor: (_c, point) => {
            return point.multiplyUnsafe(BLS_X).add(point);
          },
          mapToCurve: (scalars) => {
            const { x: x5, y } = G1_SWU(Fp.create(scalars[0]));
            return isogenyMapG1(x5, y);
          },
          fromBytes: (bytes) => {
            const { compressed, infinity, sort, value: value4 } = parseMask(bytes);
            if (value4.length === 48 && compressed) {
              const P2 = Fp.ORDER;
              const compressedValue = bytesToNumberBE(value4);
              const x5 = Fp.create(compressedValue & Fp.MASK);
              if (infinity) {
                if (x5 !== _0n7)
                  throw new Error("G1: non-empty compressed point at infinity");
                return { x: _0n7, y: _0n7 };
              }
              const right = Fp.add(Fp.pow(x5, _3n5), Fp.create(bls12_381.params.G1b));
              let y = Fp.sqrt(right);
              if (!y)
                throw new Error("invalid compressed G1 point");
              if (y * _2n6 / P2 !== BigInt(sort))
                y = Fp.neg(y);
              return { x: Fp.create(x5), y: Fp.create(y) };
            } else if (value4.length === 96 && !compressed) {
              const x5 = bytesToNumberBE(value4.subarray(0, Fp.BYTES));
              const y = bytesToNumberBE(value4.subarray(Fp.BYTES));
              if (infinity) {
                if (x5 !== _0n7 || y !== _0n7)
                  throw new Error("G1: non-empty point at infinity");
                return bls12_381.G1.ProjectivePoint.ZERO.toAffine();
              }
              return { x: Fp.create(x5), y: Fp.create(y) };
            } else {
              throw new Error("invalid point G1, expected 48/96 bytes");
            }
          },
          toBytes: (c3, point, isCompressed) => {
            const isZero = point.equals(c3.ZERO);
            const { x: x5, y } = point.toAffine();
            if (isCompressed) {
              if (isZero)
                return COMPRESSED_ZERO.slice();
              const P2 = Fp.ORDER;
              const sort = Boolean(y * _2n6 / P2);
              return setMask(numberToBytesBE(x5, Fp.BYTES), { compressed: true, sort });
            } else {
              if (isZero) {
                const x6 = concatBytes(new Uint8Array([64]), new Uint8Array(2 * Fp.BYTES - 1));
                return x6;
              } else {
                return concatBytes(numberToBytesBE(x5, Fp.BYTES), numberToBytesBE(y, Fp.BYTES));
              }
            }
          },
          ShortSignature: {
            fromHex(hex) {
              const { infinity, sort, value: value4 } = parseMask(ensureBytes("signatureHex", hex, 48));
              const P2 = Fp.ORDER;
              const compressedValue = bytesToNumberBE(value4);
              if (infinity)
                return bls12_381.G1.ProjectivePoint.ZERO;
              const x5 = Fp.create(compressedValue & Fp.MASK);
              const right = Fp.add(Fp.pow(x5, _3n5), Fp.create(bls12_381.params.G1b));
              let y = Fp.sqrt(right);
              if (!y)
                throw new Error("invalid compressed G1 point");
              const aflag = BigInt(sort);
              if (y * _2n6 / P2 !== aflag)
                y = Fp.neg(y);
              const point = bls12_381.G1.ProjectivePoint.fromAffine({ x: x5, y });
              point.assertValidity();
              return point;
            },
            toRawBytes(point) {
              return signatureG1ToRawBytes(point);
            },
            toHex(point) {
              return bytesToHex(signatureG1ToRawBytes(point));
            }
          }
        },
        // G2 is the order-q subgroup of E2(Fp²) : y² = x³+4(1+√−1),
        // where Fp2 is Fp[√−1]/(x2+1). #E2(Fp2 ) = h2q, where
        // G² - 1
        // h2q
        G2: {
          Fp: Fp2,
          // cofactor
          h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
          Gx: Fp2.fromBigTuple([
            BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
            BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
          ]),
          // y =
          // 927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582,
          // 1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905
          Gy: Fp2.fromBigTuple([
            BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
            BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
          ]),
          a: Fp2.ZERO,
          b: Fp2.fromBigTuple([_4n3, _4n3]),
          hEff: BigInt("0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551"),
          htfDefaults: { ...htfDefaults },
          wrapPrivateKey: true,
          allowInfinityPoint: true,
          mapToCurve: (scalars) => {
            const { x: x5, y } = G2_SWU(Fp2.fromBigTuple(scalars));
            return isogenyMapG2(x5, y);
          },
          // Checks is the point resides in prime-order subgroup.
          // point.isTorsionFree() should return true for valid points
          // It returns false for shitty points.
          // https://eprint.iacr.org/2021/1130.pdf
          isTorsionFree: (c3, P2) => {
            return P2.multiplyUnsafe(BLS_X).negate().equals(G2psi(c3, P2));
          },
          // Maps the point into the prime-order subgroup G2.
          // clear_cofactor_bls12381_g2 from cfrg-hash-to-curve-11
          // https://eprint.iacr.org/2017/419.pdf
          // prettier-ignore
          clearCofactor: (c3, P2) => {
            const x5 = BLS_X;
            let t1 = P2.multiplyUnsafe(x5).negate();
            let t2 = G2psi(c3, P2);
            let t3 = P2.double();
            t3 = G2psi2(c3, t3);
            t3 = t3.subtract(t2);
            t2 = t1.add(t2);
            t2 = t2.multiplyUnsafe(x5).negate();
            t3 = t3.add(t2);
            t3 = t3.subtract(t1);
            const Q = t3.subtract(P2);
            return Q;
          },
          fromBytes: (bytes) => {
            const { compressed, infinity, sort, value: value4 } = parseMask(bytes);
            if (!compressed && !infinity && sort || // 00100000
            !compressed && infinity && sort || // 01100000
            sort && infinity && compressed) {
              throw new Error("invalid encoding flag: " + (bytes[0] & 224));
            }
            const L3 = Fp.BYTES;
            const slc = (b3, from, to) => bytesToNumberBE(b3.slice(from, to));
            if (value4.length === 96 && compressed) {
              const b3 = bls12_381.params.G2b;
              const P2 = Fp.ORDER;
              if (infinity) {
                if (value4.reduce((p3, c3) => p3 !== 0 ? c3 + 1 : c3, 0) > 0) {
                  throw new Error("invalid compressed G2 point");
                }
                return { x: Fp2.ZERO, y: Fp2.ZERO };
              }
              const x_1 = slc(value4, 0, L3);
              const x_0 = slc(value4, L3, 2 * L3);
              const x5 = Fp2.create({ c0: Fp.create(x_0), c1: Fp.create(x_1) });
              const right = Fp2.add(Fp2.pow(x5, _3n5), b3);
              let y = Fp2.sqrt(right);
              const Y_bit = y.c1 === _0n7 ? y.c0 * _2n6 / P2 : y.c1 * _2n6 / P2 ? _1n7 : _0n7;
              y = sort && Y_bit > 0 ? y : Fp2.neg(y);
              return { x: x5, y };
            } else if (value4.length === 192 && !compressed) {
              if (infinity) {
                if (value4.reduce((p3, c3) => p3 !== 0 ? c3 + 1 : c3, 0) > 0) {
                  throw new Error("invalid uncompressed G2 point");
                }
                return { x: Fp2.ZERO, y: Fp2.ZERO };
              }
              const x1 = slc(value4, 0, L3);
              const x0 = slc(value4, L3, 2 * L3);
              const y1 = slc(value4, 2 * L3, 3 * L3);
              const y0 = slc(value4, 3 * L3, 4 * L3);
              return { x: Fp2.fromBigTuple([x0, x1]), y: Fp2.fromBigTuple([y0, y1]) };
            } else {
              throw new Error("invalid point G2, expected 96/192 bytes");
            }
          },
          toBytes: (c3, point, isCompressed) => {
            const { BYTES: len, ORDER: P2 } = Fp;
            const isZero = point.equals(c3.ZERO);
            const { x: x5, y } = point.toAffine();
            if (isCompressed) {
              if (isZero)
                return concatBytes(COMPRESSED_ZERO, numberToBytesBE(_0n7, len));
              const flag = Boolean(y.c1 === _0n7 ? y.c0 * _2n6 / P2 : y.c1 * _2n6 / P2);
              return concatBytes(setMask(numberToBytesBE(x5.c1, len), { compressed: true, sort: flag }), numberToBytesBE(x5.c0, len));
            } else {
              if (isZero)
                return concatBytes(new Uint8Array([64]), new Uint8Array(4 * len - 1));
              const { re: x0, im: x1 } = Fp2.reim(x5);
              const { re: y0, im: y1 } = Fp2.reim(y);
              return concatBytes(numberToBytesBE(x1, len), numberToBytesBE(x0, len), numberToBytesBE(y1, len), numberToBytesBE(y0, len));
            }
          },
          Signature: {
            // TODO: Optimize, it's very slow because of sqrt.
            fromHex(hex) {
              const { infinity, sort, value: value4 } = parseMask(ensureBytes("signatureHex", hex));
              const P2 = Fp.ORDER;
              const half = value4.length / 2;
              if (half !== 48 && half !== 96)
                throw new Error("invalid compressed signature length, must be 96 or 192");
              const z1 = bytesToNumberBE(value4.slice(0, half));
              const z2 = bytesToNumberBE(value4.slice(half));
              if (infinity)
                return bls12_381.G2.ProjectivePoint.ZERO;
              const x1 = Fp.create(z1 & Fp.MASK);
              const x22 = Fp.create(z2);
              const x5 = Fp2.create({ c0: x22, c1: x1 });
              const y2 = Fp2.add(Fp2.pow(x5, _3n5), bls12_381.params.G2b);
              let y = Fp2.sqrt(y2);
              if (!y)
                throw new Error("Failed to find a square root");
              const { re: y0, im: y1 } = Fp2.reim(y);
              const aflag1 = BigInt(sort);
              const isGreater = y1 > _0n7 && y1 * _2n6 / P2 !== aflag1;
              const isZero = y1 === _0n7 && y0 * _2n6 / P2 !== aflag1;
              if (isGreater || isZero)
                y = Fp2.neg(y);
              const point = bls12_381.G2.ProjectivePoint.fromAffine({ x: x5, y });
              point.assertValidity();
              return point;
            },
            toRawBytes(point) {
              return signatureG2ToRawBytes(point);
            },
            toHex(point) {
              return bytesToHex(signatureG2ToRawBytes(point));
            }
          }
        },
        params: {
          ateLoopSize: BLS_X,
          // The BLS parameter x for BLS12-381
          r: Fr.ORDER,
          // order; z⁴ − z² + 1; CURVE.n from other curves
          xNegative: true,
          twistType: "multiplicative"
        },
        htfDefaults,
        hash: sha256,
        randomBytes
      });
    }
  });

  // node_modules/@dfinity/agent/lib/esm/utils/bls.js
  function blsVerify(pk, sig, msg) {
    const primaryKey = typeof pk === "string" ? pk : toHex(pk);
    const signature = typeof sig === "string" ? sig : toHex(sig);
    const message = typeof msg === "string" ? msg : toHex(msg);
    return bls12_381.verifyShortSignature(signature, message, primaryKey);
  }
  var init_bls2 = __esm({
    "node_modules/@dfinity/agent/lib/esm/utils/bls.js"() {
      init_bls12_381();
      init_buffer();
    }
  });

  // node_modules/@dfinity/agent/lib/esm/utils/leb.js
  var decodeLeb128, decodeTime;
  var init_leb = __esm({
    "node_modules/@dfinity/agent/lib/esm/utils/leb.js"() {
      init_esm2();
      decodeLeb128 = (buf) => {
        return lebDecode(new PipeArrayBuffer(buf));
      };
      decodeTime = (buf) => {
        const decoded = decodeLeb128(buf);
        return new Date(Number(decoded) / 1e6);
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/certificate.js
  function isBufferGreaterThan(a, b3) {
    const a8 = new Uint8Array(a);
    const b8 = new Uint8Array(b3);
    for (let i = 0; i < a8.length; i++) {
      if (a8[i] > b8[i]) {
        return true;
      }
    }
    return false;
  }
  function extractDER(buf) {
    const expectedLength = DER_PREFIX.byteLength + KEY_LENGTH;
    if (buf.byteLength !== expectedLength) {
      throw new TypeError(`BLS DER-encoded public key must be ${expectedLength} bytes long`);
    }
    const prefix = buf.slice(0, DER_PREFIX.byteLength);
    if (!bufEquals(prefix, DER_PREFIX)) {
      throw new TypeError(`BLS DER-encoded public key is invalid. Expect the following prefix: ${DER_PREFIX}, but get ${prefix}`);
    }
    return buf.slice(DER_PREFIX.byteLength);
  }
  function lookupResultToBuffer(result) {
    if (result.status !== LookupStatus.Found) {
      return void 0;
    }
    if (result.value instanceof ArrayBuffer) {
      return result.value;
    }
    if (result.value instanceof Uint8Array) {
      return result.value.buffer;
    }
    return void 0;
  }
  async function reconstruct(t2) {
    switch (t2[0]) {
      case NodeType.Empty:
        return hash(domain_sep("ic-hashtree-empty"));
      case NodeType.Pruned:
        return t2[1];
      case NodeType.Leaf:
        return hash(concat(domain_sep("ic-hashtree-leaf"), t2[1]));
      case NodeType.Labeled:
        return hash(concat(domain_sep("ic-hashtree-labeled"), t2[1], await reconstruct(t2[2])));
      case NodeType.Fork:
        return hash(concat(domain_sep("ic-hashtree-fork"), await reconstruct(t2[1]), await reconstruct(t2[2])));
      default:
        throw new Error("unreachable");
    }
  }
  function domain_sep(s2) {
    const len = new Uint8Array([s2.length]);
    const str = new TextEncoder().encode(s2);
    return concat(len, str);
  }
  function lookup_path(path, tree) {
    if (path.length === 0) {
      switch (tree[0]) {
        case NodeType.Leaf: {
          if (!tree[1]) {
            throw new Error("Invalid tree structure for leaf");
          }
          if (tree[1] instanceof ArrayBuffer) {
            return {
              status: LookupStatus.Found,
              value: tree[1]
            };
          }
          if (tree[1] instanceof Uint8Array) {
            return {
              status: LookupStatus.Found,
              value: tree[1].buffer
            };
          }
          return {
            status: LookupStatus.Found,
            value: tree[1]
          };
        }
        default: {
          return {
            status: LookupStatus.Found,
            value: tree
          };
        }
      }
    }
    const label = typeof path[0] === "string" ? new TextEncoder().encode(path[0]) : path[0];
    const lookupResult = find_label(label, tree);
    switch (lookupResult.status) {
      case LookupStatus.Found: {
        return lookup_path(path.slice(1), lookupResult.value);
      }
      case LabelLookupStatus.Greater:
      case LabelLookupStatus.Less: {
        return {
          status: LookupStatus.Absent
        };
      }
      default: {
        return lookupResult;
      }
    }
  }
  function flatten_forks(t2) {
    switch (t2[0]) {
      case NodeType.Empty:
        return [];
      case NodeType.Fork:
        return flatten_forks(t2[1]).concat(flatten_forks(t2[2]));
      default:
        return [t2];
    }
  }
  function find_label(label, tree) {
    switch (tree[0]) {
      case NodeType.Labeled:
        if (isBufferGreaterThan(label, tree[1])) {
          return {
            status: LabelLookupStatus.Greater
          };
        }
        if (bufEquals(label, tree[1])) {
          return {
            status: LookupStatus.Found,
            value: tree[2]
          };
        }
        return {
          status: LabelLookupStatus.Less
        };
      case NodeType.Fork:
        const leftLookupResult = find_label(label, tree[1]);
        switch (leftLookupResult.status) {
          case LabelLookupStatus.Greater: {
            const rightLookupResult = find_label(label, tree[2]);
            if (rightLookupResult.status === LabelLookupStatus.Less) {
              return {
                status: LookupStatus.Absent
              };
            }
            return rightLookupResult;
          }
          case LookupStatus.Unknown: {
            let rightLookupResult = find_label(label, tree[2]);
            if (rightLookupResult.status === LabelLookupStatus.Less) {
              return {
                status: LookupStatus.Unknown
              };
            }
            return rightLookupResult;
          }
          default: {
            return leftLookupResult;
          }
        }
      case NodeType.Pruned:
        return {
          status: LookupStatus.Unknown
        };
      default:
        return {
          status: LookupStatus.Absent
        };
    }
  }
  function check_canister_ranges(params) {
    const { canisterId, subnetId, tree } = params;
    const rangeLookup = lookup_path(["subnet", subnetId.toUint8Array(), "canister_ranges"], tree);
    if (rangeLookup.status !== LookupStatus.Found || !(rangeLookup.value instanceof ArrayBuffer)) {
      throw new Error(`Could not find canister ranges for subnet ${subnetId}`);
    }
    const ranges_arr = decode3(rangeLookup.value);
    const ranges = ranges_arr.map((v2) => [
      Principal.fromUint8Array(v2[0]),
      Principal.fromUint8Array(v2[1])
    ]);
    const canisterInRange = ranges.some((r) => r[0].ltEq(canisterId) && r[1].gtEq(canisterId));
    return canisterInRange;
  }
  var CertificateVerificationError, NodeType, Certificate, DER_PREFIX, KEY_LENGTH, LookupStatus, LabelLookupStatus;
  var init_certificate = __esm({
    "node_modules/@dfinity/agent/lib/esm/certificate.js"() {
      init_cbor();
      init_errors();
      init_request_id();
      init_buffer();
      init_esm();
      init_bls2();
      init_leb();
      init_agent();
      CertificateVerificationError = class extends AgentError {
        constructor(reason) {
          super(`Invalid certificate: ${reason}`);
        }
      };
      (function(NodeType2) {
        NodeType2[NodeType2["Empty"] = 0] = "Empty";
        NodeType2[NodeType2["Fork"] = 1] = "Fork";
        NodeType2[NodeType2["Labeled"] = 2] = "Labeled";
        NodeType2[NodeType2["Leaf"] = 3] = "Leaf";
        NodeType2[NodeType2["Pruned"] = 4] = "Pruned";
      })(NodeType || (NodeType = {}));
      Certificate = class _Certificate {
        constructor(certificate, _rootKey, _canisterId, _blsVerify, _maxAgeInMinutes = 5) {
          this._rootKey = _rootKey;
          this._canisterId = _canisterId;
          this._blsVerify = _blsVerify;
          this._maxAgeInMinutes = _maxAgeInMinutes;
          this.cert = decode3(new Uint8Array(certificate));
        }
        /**
         * Create a new instance of a certificate, automatically verifying it. Throws a
         * CertificateVerificationError if the certificate cannot be verified.
         * @constructs  Certificate
         * @param {CreateCertificateOptions} options {@link CreateCertificateOptions}
         * @param {ArrayBuffer} options.certificate The bytes of the certificate
         * @param {ArrayBuffer} options.rootKey The root key to verify against
         * @param {Principal} options.canisterId The effective or signing canister ID
         * @param {number} options.maxAgeInMinutes The maximum age of the certificate in minutes. Default is 5 minutes.
         * @throws {CertificateVerificationError}
         */
        static async create(options) {
          const cert = _Certificate.createUnverified(options);
          await cert.verify();
          return cert;
        }
        static createUnverified(options) {
          let blsVerify2 = options.blsVerify;
          if (!blsVerify2) {
            blsVerify2 = blsVerify;
          }
          return new _Certificate(options.certificate, options.rootKey, options.canisterId, blsVerify2, options.maxAgeInMinutes);
        }
        lookup(path) {
          return lookup_path(path, this.cert.tree);
        }
        lookup_label(label) {
          return this.lookup([label]);
        }
        async verify() {
          const rootHash = await reconstruct(this.cert.tree);
          const derKey = await this._checkDelegationAndGetKey(this.cert.delegation);
          const sig = this.cert.signature;
          const key = extractDER(derKey);
          const msg = concat(domain_sep("ic-state-root"), rootHash);
          let sigVer = false;
          const lookupTime = lookupResultToBuffer(this.lookup(["time"]));
          if (!lookupTime) {
            throw new CertificateVerificationError("Certificate does not contain a time");
          }
          const FIVE_MINUTES_IN_MSEC2 = 5 * 60 * 1e3;
          const MAX_AGE_IN_MSEC = this._maxAgeInMinutes * 60 * 1e3;
          const now = Date.now();
          const earliestCertificateTime = now - MAX_AGE_IN_MSEC;
          const fiveMinutesFromNow = now + FIVE_MINUTES_IN_MSEC2;
          const certTime = decodeTime(lookupTime);
          if (certTime.getTime() < earliestCertificateTime) {
            throw new CertificateVerificationError(`Certificate is signed more than ${this._maxAgeInMinutes} minutes in the past. Certificate time: ` + certTime.toISOString() + " Current time: " + new Date(now).toISOString());
          } else if (certTime.getTime() > fiveMinutesFromNow) {
            throw new CertificateVerificationError("Certificate is signed more than 5 minutes in the future. Certificate time: " + certTime.toISOString() + " Current time: " + new Date(now).toISOString());
          }
          try {
            sigVer = await this._blsVerify(new Uint8Array(key), new Uint8Array(sig), new Uint8Array(msg));
          } catch (err) {
            sigVer = false;
          }
          if (!sigVer) {
            throw new CertificateVerificationError("Signature verification failed");
          }
        }
        async _checkDelegationAndGetKey(d2) {
          if (!d2) {
            return this._rootKey;
          }
          const cert = await _Certificate.createUnverified({
            certificate: d2.certificate,
            rootKey: this._rootKey,
            canisterId: this._canisterId,
            blsVerify: this._blsVerify,
            // Do not check max age for delegation certificates
            maxAgeInMinutes: Infinity
          });
          if (cert.cert.delegation) {
            throw new CertificateVerificationError("Delegation certificates cannot be nested");
          }
          await cert.verify();
          if (this._canisterId.toString() !== MANAGEMENT_CANISTER_ID) {
            const canisterInRange = check_canister_ranges({
              canisterId: this._canisterId,
              subnetId: Principal.fromUint8Array(new Uint8Array(d2.subnet_id)),
              tree: cert.cert.tree
            });
            if (!canisterInRange) {
              throw new CertificateVerificationError(`Canister ${this._canisterId} not in range of delegations for subnet 0x${toHex(d2.subnet_id)}`);
            }
          }
          const publicKeyLookup = lookupResultToBuffer(cert.lookup(["subnet", d2.subnet_id, "public_key"]));
          if (!publicKeyLookup) {
            throw new Error(`Could not find subnet key for subnet 0x${toHex(d2.subnet_id)}`);
          }
          return publicKeyLookup;
        }
      };
      DER_PREFIX = fromHex("308182301d060d2b0601040182dc7c0503010201060c2b0601040182dc7c05030201036100");
      KEY_LENGTH = 96;
      (function(LookupStatus2) {
        LookupStatus2["Unknown"] = "unknown";
        LookupStatus2["Absent"] = "absent";
        LookupStatus2["Found"] = "found";
      })(LookupStatus || (LookupStatus = {}));
      (function(LabelLookupStatus2) {
        LabelLookupStatus2["Less"] = "less";
        LabelLookupStatus2["Greater"] = "greater";
      })(LabelLookupStatus || (LabelLookupStatus = {}));
    }
  });

  // node_modules/@dfinity/agent/lib/esm/canisterStatus/index.js
  var canisterStatus_exports = {};
  __export(canisterStatus_exports, {
    CustomPath: () => CustomPath,
    encodePath: () => encodePath,
    fetchNodeKeys: () => fetchNodeKeys,
    request: () => request
  });
  var CustomPath, request, fetchNodeKeys, encodePath, decodeHex, decodeCbor, decodeUtf8, decodeControllers;
  var init_canisterStatus = __esm({
    "node_modules/@dfinity/agent/lib/esm/canisterStatus/index.js"() {
      init_esm();
      init_errors();
      init_certificate();
      init_buffer();
      init_cbor();
      init_leb();
      CustomPath = class {
        constructor(key, path, decodeStrategy) {
          this.key = key;
          this.path = path;
          this.decodeStrategy = decodeStrategy;
        }
      };
      request = async (options) => {
        const { agent, paths } = options;
        const canisterId = Principal.from(options.canisterId);
        const uniquePaths = [...new Set(paths)];
        const encodedPaths = uniquePaths.map((path) => {
          return encodePath(path, canisterId);
        });
        const status = /* @__PURE__ */ new Map();
        const promises = uniquePaths.map((path, index) => {
          return (async () => {
            var _a2;
            try {
              const response = await agent.readState(canisterId, {
                paths: [encodedPaths[index]]
              });
              const cert = await Certificate.create({
                certificate: response.certificate,
                rootKey: agent.rootKey,
                canisterId
              });
              const lookup = (cert2, path3) => {
                if (path3 === "subnet") {
                  const data2 = fetchNodeKeys(response.certificate, canisterId, agent.rootKey);
                  return {
                    path: path3,
                    data: data2
                  };
                } else {
                  return {
                    path: path3,
                    data: lookupResultToBuffer(cert2.lookup(encodePath(path3, canisterId)))
                  };
                }
              };
              const { path: path2, data } = lookup(cert, uniquePaths[index]);
              if (!data) {
                console.warn(`Expected to find result for path ${path2}, but instead found nothing.`);
                if (typeof path2 === "string") {
                  status.set(path2, null);
                } else {
                  status.set(path2.key, null);
                }
              } else {
                switch (path2) {
                  case "time": {
                    status.set(path2, decodeTime(data));
                    break;
                  }
                  case "controllers": {
                    status.set(path2, decodeControllers(data));
                    break;
                  }
                  case "module_hash": {
                    status.set(path2, decodeHex(data));
                    break;
                  }
                  case "subnet": {
                    status.set(path2, data);
                    break;
                  }
                  case "candid": {
                    status.set(path2, new TextDecoder().decode(data));
                    break;
                  }
                  default: {
                    if (typeof path2 !== "string" && "key" in path2 && "path" in path2) {
                      switch (path2.decodeStrategy) {
                        case "raw":
                          status.set(path2.key, data);
                          break;
                        case "leb128": {
                          status.set(path2.key, decodeLeb128(data));
                          break;
                        }
                        case "cbor": {
                          status.set(path2.key, decodeCbor(data));
                          break;
                        }
                        case "hex": {
                          status.set(path2.key, decodeHex(data));
                          break;
                        }
                        case "utf-8": {
                          status.set(path2.key, decodeUtf8(data));
                        }
                      }
                    }
                  }
                }
              }
            } catch (error) {
              if ((_a2 = error === null || error === void 0 ? void 0 : error.message) === null || _a2 === void 0 ? void 0 : _a2.includes("Invalid certificate")) {
                throw new AgentError(error.message);
              }
              if (typeof path !== "string" && "key" in path && "path" in path) {
                status.set(path.key, null);
              } else {
                status.set(path, null);
              }
              console.group();
              console.warn(`Expected to find result for path ${path}, but instead found nothing.`);
              console.warn(error);
              console.groupEnd();
            }
          })();
        });
        await Promise.all(promises);
        return status;
      };
      fetchNodeKeys = (certificate, canisterId, root_key) => {
        if (!canisterId._isPrincipal) {
          throw new Error("Invalid canisterId");
        }
        const cert = decode3(new Uint8Array(certificate));
        const tree = cert.tree;
        let delegation = cert.delegation;
        let subnetId;
        if (delegation && delegation.subnet_id) {
          subnetId = Principal.fromUint8Array(new Uint8Array(delegation.subnet_id));
        } else if (!delegation && typeof root_key !== "undefined") {
          subnetId = Principal.selfAuthenticating(new Uint8Array(root_key));
          delegation = {
            subnet_id: subnetId.toUint8Array(),
            certificate: new ArrayBuffer(0)
          };
        } else {
          subnetId = Principal.selfAuthenticating(Principal.fromText("tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe").toUint8Array());
          delegation = {
            subnet_id: subnetId.toUint8Array(),
            certificate: new ArrayBuffer(0)
          };
        }
        const canisterInRange = check_canister_ranges({ canisterId, subnetId, tree });
        if (!canisterInRange) {
          throw new Error("Canister not in range");
        }
        const subnetLookupResult = lookup_path(["subnet", delegation.subnet_id, "node"], tree);
        if (subnetLookupResult.status !== LookupStatus.Found) {
          throw new Error("Node not found");
        }
        if (subnetLookupResult.value instanceof ArrayBuffer) {
          throw new Error("Invalid node tree");
        }
        const nodeForks = flatten_forks(subnetLookupResult.value);
        const nodeKeys = /* @__PURE__ */ new Map();
        nodeForks.forEach((fork) => {
          const node_id = Principal.from(new Uint8Array(fork[1])).toText();
          const publicKeyLookupResult = lookup_path(["public_key"], fork[2]);
          if (publicKeyLookupResult.status !== LookupStatus.Found) {
            throw new Error("Public key not found");
          }
          const derEncodedPublicKey = publicKeyLookupResult.value;
          if (derEncodedPublicKey.byteLength !== 44) {
            throw new Error("Invalid public key length");
          } else {
            nodeKeys.set(node_id, derEncodedPublicKey);
          }
        });
        return {
          subnetId: Principal.fromUint8Array(new Uint8Array(delegation.subnet_id)).toText(),
          nodeKeys
        };
      };
      encodePath = (path, canisterId) => {
        const encoder = new TextEncoder();
        const encode4 = (arg) => {
          return new DataView(encoder.encode(arg).buffer).buffer;
        };
        const canisterBuffer = new DataView(canisterId.toUint8Array().buffer).buffer;
        switch (path) {
          case "time":
            return [encode4("time")];
          case "controllers":
            return [encode4("canister"), canisterBuffer, encode4("controllers")];
          case "module_hash":
            return [encode4("canister"), canisterBuffer, encode4("module_hash")];
          case "subnet":
            return [encode4("subnet")];
          case "candid":
            return [encode4("canister"), canisterBuffer, encode4("metadata"), encode4("candid:service")];
          default: {
            if ("key" in path && "path" in path) {
              if (typeof path["path"] === "string" || path["path"] instanceof ArrayBuffer) {
                const metaPath = path.path;
                const encoded = typeof metaPath === "string" ? encode4(metaPath) : metaPath;
                return [encode4("canister"), canisterBuffer, encode4("metadata"), encoded];
              } else {
                return path["path"];
              }
            }
          }
        }
        throw new Error(`An unexpeected error was encountered while encoding your path for canister status. Please ensure that your path, ${path} was formatted correctly.`);
      };
      decodeHex = (buf) => {
        return toHex(buf);
      };
      decodeCbor = (buf) => {
        return decode3(buf);
      };
      decodeUtf8 = (buf) => {
        return new TextDecoder().decode(buf);
      };
      decodeControllers = (buf) => {
        const controllersRaw = decodeCbor(buf);
        return controllersRaw.map((buf2) => {
          return Principal.fromUint8Array(new Uint8Array(buf2));
        });
      };
    }
  });

  // node_modules/@noble/hashes/esm/_u64.js
  function fromBig(n2, le = false) {
    if (le)
      return { h: Number(n2 & U32_MASK64), l: Number(n2 >> _32n & U32_MASK64) };
    return { h: Number(n2 >> _32n & U32_MASK64) | 0, l: Number(n2 & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    let Ah = new Uint32Array(lst.length);
    let Al = new Uint32Array(lst.length);
    for (let i = 0; i < lst.length; i++) {
      const { h: h3, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h3, l];
    }
    return [Ah, Al];
  }
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var U32_MASK64, _32n, toBig, shrSH, shrSL, rotrSH, rotrSL, rotrBH, rotrBL, rotr32H, rotr32L, rotlSH, rotlSL, rotlBH, rotlBL, add3L, add3H, add4L, add4H, add5L, add5H, u64, u64_default;
  var init_u64 = __esm({
    "node_modules/@noble/hashes/esm/_u64.js"() {
      U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
      _32n = /* @__PURE__ */ BigInt(32);
      toBig = (h3, l) => BigInt(h3 >>> 0) << _32n | BigInt(l >>> 0);
      shrSH = (h3, _l, s2) => h3 >>> s2;
      shrSL = (h3, l, s2) => h3 << 32 - s2 | l >>> s2;
      rotrSH = (h3, l, s2) => h3 >>> s2 | l << 32 - s2;
      rotrSL = (h3, l, s2) => h3 << 32 - s2 | l >>> s2;
      rotrBH = (h3, l, s2) => h3 << 64 - s2 | l >>> s2 - 32;
      rotrBL = (h3, l, s2) => h3 >>> s2 - 32 | l << 64 - s2;
      rotr32H = (_h, l) => l;
      rotr32L = (h3, _l) => h3;
      rotlSH = (h3, l, s2) => h3 << s2 | l >>> 32 - s2;
      rotlSL = (h3, l, s2) => l << s2 | h3 >>> 32 - s2;
      rotlBH = (h3, l, s2) => l << s2 - 32 | h3 >>> 64 - s2;
      rotlBL = (h3, l, s2) => h3 << s2 - 32 | l >>> 64 - s2;
      add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
      add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
      add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
      add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
      add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
      add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
      u64 = {
        fromBig,
        split,
        toBig,
        shrSH,
        shrSL,
        rotrSH,
        rotrSL,
        rotrBH,
        rotrBL,
        rotr32H,
        rotr32L,
        rotlSH,
        rotlSL,
        rotlBH,
        rotlBL,
        add,
        add3L,
        add3H,
        add4L,
        add4H,
        add5H,
        add5L
      };
      u64_default = u64;
    }
  });

  // node_modules/@noble/hashes/esm/sha512.js
  var SHA512_Kh, SHA512_Kl, SHA512_W_H, SHA512_W_L, SHA512, sha512;
  var init_sha512 = __esm({
    "node_modules/@noble/hashes/esm/sha512.js"() {
      init_md();
      init_u64();
      init_utils();
      [SHA512_Kh, SHA512_Kl] = /* @__PURE__ */ (() => u64_default.split([
        "0x428a2f98d728ae22",
        "0x7137449123ef65cd",
        "0xb5c0fbcfec4d3b2f",
        "0xe9b5dba58189dbbc",
        "0x3956c25bf348b538",
        "0x59f111f1b605d019",
        "0x923f82a4af194f9b",
        "0xab1c5ed5da6d8118",
        "0xd807aa98a3030242",
        "0x12835b0145706fbe",
        "0x243185be4ee4b28c",
        "0x550c7dc3d5ffb4e2",
        "0x72be5d74f27b896f",
        "0x80deb1fe3b1696b1",
        "0x9bdc06a725c71235",
        "0xc19bf174cf692694",
        "0xe49b69c19ef14ad2",
        "0xefbe4786384f25e3",
        "0x0fc19dc68b8cd5b5",
        "0x240ca1cc77ac9c65",
        "0x2de92c6f592b0275",
        "0x4a7484aa6ea6e483",
        "0x5cb0a9dcbd41fbd4",
        "0x76f988da831153b5",
        "0x983e5152ee66dfab",
        "0xa831c66d2db43210",
        "0xb00327c898fb213f",
        "0xbf597fc7beef0ee4",
        "0xc6e00bf33da88fc2",
        "0xd5a79147930aa725",
        "0x06ca6351e003826f",
        "0x142929670a0e6e70",
        "0x27b70a8546d22ffc",
        "0x2e1b21385c26c926",
        "0x4d2c6dfc5ac42aed",
        "0x53380d139d95b3df",
        "0x650a73548baf63de",
        "0x766a0abb3c77b2a8",
        "0x81c2c92e47edaee6",
        "0x92722c851482353b",
        "0xa2bfe8a14cf10364",
        "0xa81a664bbc423001",
        "0xc24b8b70d0f89791",
        "0xc76c51a30654be30",
        "0xd192e819d6ef5218",
        "0xd69906245565a910",
        "0xf40e35855771202a",
        "0x106aa07032bbd1b8",
        "0x19a4c116b8d2d0c8",
        "0x1e376c085141ab53",
        "0x2748774cdf8eeb99",
        "0x34b0bcb5e19b48a8",
        "0x391c0cb3c5c95a63",
        "0x4ed8aa4ae3418acb",
        "0x5b9cca4f7763e373",
        "0x682e6ff3d6b2b8a3",
        "0x748f82ee5defb2fc",
        "0x78a5636f43172f60",
        "0x84c87814a1f0ab72",
        "0x8cc702081a6439ec",
        "0x90befffa23631e28",
        "0xa4506cebde82bde9",
        "0xbef9a3f7b2c67915",
        "0xc67178f2e372532b",
        "0xca273eceea26619c",
        "0xd186b8c721c0c207",
        "0xeada7dd6cde0eb1e",
        "0xf57d4f7fee6ed178",
        "0x06f067aa72176fba",
        "0x0a637dc5a2c898a6",
        "0x113f9804bef90dae",
        "0x1b710b35131c471b",
        "0x28db77f523047d84",
        "0x32caab7b40c72493",
        "0x3c9ebe0a15c9bebc",
        "0x431d67c49c100d4c",
        "0x4cc5d4becb3e42b6",
        "0x597f299cfc657e2a",
        "0x5fcb6fab3ad6faec",
        "0x6c44198c4a475817"
      ].map((n2) => BigInt(n2))))();
      SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
      SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
      SHA512 = class extends HashMD {
        constructor() {
          super(128, 64, 16, false);
          this.Ah = 1779033703 | 0;
          this.Al = 4089235720 | 0;
          this.Bh = 3144134277 | 0;
          this.Bl = 2227873595 | 0;
          this.Ch = 1013904242 | 0;
          this.Cl = 4271175723 | 0;
          this.Dh = 2773480762 | 0;
          this.Dl = 1595750129 | 0;
          this.Eh = 1359893119 | 0;
          this.El = 2917565137 | 0;
          this.Fh = 2600822924 | 0;
          this.Fl = 725511199 | 0;
          this.Gh = 528734635 | 0;
          this.Gl = 4215389547 | 0;
          this.Hh = 1541459225 | 0;
          this.Hl = 327033209 | 0;
        }
        // prettier-ignore
        get() {
          const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
          return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
        }
        // prettier-ignore
        set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
          this.Ah = Ah | 0;
          this.Al = Al | 0;
          this.Bh = Bh | 0;
          this.Bl = Bl | 0;
          this.Ch = Ch | 0;
          this.Cl = Cl | 0;
          this.Dh = Dh | 0;
          this.Dl = Dl | 0;
          this.Eh = Eh | 0;
          this.El = El | 0;
          this.Fh = Fh | 0;
          this.Fl = Fl | 0;
          this.Gh = Gh | 0;
          this.Gl = Gl | 0;
          this.Hh = Hh | 0;
          this.Hl = Hl | 0;
        }
        process(view, offset) {
          for (let i = 0; i < 16; i++, offset += 4) {
            SHA512_W_H[i] = view.getUint32(offset);
            SHA512_W_L[i] = view.getUint32(offset += 4);
          }
          for (let i = 16; i < 80; i++) {
            const W15h = SHA512_W_H[i - 15] | 0;
            const W15l = SHA512_W_L[i - 15] | 0;
            const s0h = u64_default.rotrSH(W15h, W15l, 1) ^ u64_default.rotrSH(W15h, W15l, 8) ^ u64_default.shrSH(W15h, W15l, 7);
            const s0l = u64_default.rotrSL(W15h, W15l, 1) ^ u64_default.rotrSL(W15h, W15l, 8) ^ u64_default.shrSL(W15h, W15l, 7);
            const W2h = SHA512_W_H[i - 2] | 0;
            const W2l = SHA512_W_L[i - 2] | 0;
            const s1h = u64_default.rotrSH(W2h, W2l, 19) ^ u64_default.rotrBH(W2h, W2l, 61) ^ u64_default.shrSH(W2h, W2l, 6);
            const s1l = u64_default.rotrSL(W2h, W2l, 19) ^ u64_default.rotrBL(W2h, W2l, 61) ^ u64_default.shrSL(W2h, W2l, 6);
            const SUMl = u64_default.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
            const SUMh = u64_default.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
            SHA512_W_H[i] = SUMh | 0;
            SHA512_W_L[i] = SUMl | 0;
          }
          let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
          for (let i = 0; i < 80; i++) {
            const sigma1h = u64_default.rotrSH(Eh, El, 14) ^ u64_default.rotrSH(Eh, El, 18) ^ u64_default.rotrBH(Eh, El, 41);
            const sigma1l = u64_default.rotrSL(Eh, El, 14) ^ u64_default.rotrSL(Eh, El, 18) ^ u64_default.rotrBL(Eh, El, 41);
            const CHIh = Eh & Fh ^ ~Eh & Gh;
            const CHIl = El & Fl ^ ~El & Gl;
            const T1ll = u64_default.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
            const T1h = u64_default.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
            const T1l = T1ll | 0;
            const sigma0h = u64_default.rotrSH(Ah, Al, 28) ^ u64_default.rotrBH(Ah, Al, 34) ^ u64_default.rotrBH(Ah, Al, 39);
            const sigma0l = u64_default.rotrSL(Ah, Al, 28) ^ u64_default.rotrBL(Ah, Al, 34) ^ u64_default.rotrBL(Ah, Al, 39);
            const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
            const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
            Hh = Gh | 0;
            Hl = Gl | 0;
            Gh = Fh | 0;
            Gl = Fl | 0;
            Fh = Eh | 0;
            Fl = El | 0;
            ({ h: Eh, l: El } = u64_default.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
            Dh = Ch | 0;
            Dl = Cl | 0;
            Ch = Bh | 0;
            Cl = Bl | 0;
            Bh = Ah | 0;
            Bl = Al | 0;
            const All = u64_default.add3L(T1l, sigma0l, MAJl);
            Ah = u64_default.add3H(All, T1h, sigma0h, MAJh);
            Al = All | 0;
          }
          ({ h: Ah, l: Al } = u64_default.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
          ({ h: Bh, l: Bl } = u64_default.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
          ({ h: Ch, l: Cl } = u64_default.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
          ({ h: Dh, l: Dl } = u64_default.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
          ({ h: Eh, l: El } = u64_default.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
          ({ h: Fh, l: Fl } = u64_default.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
          ({ h: Gh, l: Gl } = u64_default.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
          ({ h: Hh, l: Hl } = u64_default.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
          this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
        }
        roundClean() {
          SHA512_W_H.fill(0);
          SHA512_W_L.fill(0);
        }
        destroy() {
          this.buffer.fill(0);
          this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
      };
      sha512 = /* @__PURE__ */ wrapConstructor(() => new SHA512());
    }
  });

  // node_modules/@noble/curves/esm/abstract/edwards.js
  function validateOpts(curve) {
    const opts = validateBasic(curve);
    validateObject(curve, {
      hash: "function",
      a: "bigint",
      d: "bigint",
      randomBytes: "function"
    }, {
      adjustScalarBytes: "function",
      domain: "function",
      uvRatio: "function",
      mapToCurve: "function"
    });
    return Object.freeze({ ...opts });
  }
  function twistedEdwards(curveDef) {
    const CURVE = validateOpts(curveDef);
    const { Fp: Fp4, n: CURVE_ORDER, prehash, hash: cHash, randomBytes: randomBytes2, nByteLength, h: cofactor } = CURVE;
    const MASK = _2n7 << BigInt(nByteLength * 8) - _1n8;
    const modP = Fp4.create;
    const Fn = Field(CURVE.n, CURVE.nBitLength);
    const uvRatio2 = CURVE.uvRatio || ((u2, v2) => {
      try {
        return { isValid: true, value: Fp4.sqrt(u2 * Fp4.inv(v2)) };
      } catch (e3) {
        return { isValid: false, value: _0n8 };
      }
    });
    const adjustScalarBytes2 = CURVE.adjustScalarBytes || ((bytes) => bytes);
    const domain = CURVE.domain || ((data, ctx, phflag) => {
      abool("phflag", phflag);
      if (ctx.length || phflag)
        throw new Error("Contexts/pre-hash are not supported");
      return data;
    });
    function aCoordinate(title, n2) {
      aInRange("coordinate " + title, n2, _0n8, MASK);
    }
    function assertPoint(other) {
      if (!(other instanceof Point))
        throw new Error("ExtendedPoint expected");
    }
    const toAffineMemo = memoized((p3, iz) => {
      const { ex: x5, ey: y, ez: z } = p3;
      const is0 = p3.is0();
      if (iz == null)
        iz = is0 ? _8n2 : Fp4.inv(z);
      const ax = modP(x5 * iz);
      const ay = modP(y * iz);
      const zz = modP(z * iz);
      if (is0)
        return { x: _0n8, y: _1n8 };
      if (zz !== _1n8)
        throw new Error("invZ was invalid");
      return { x: ax, y: ay };
    });
    const assertValidMemo = memoized((p3) => {
      const { a, d: d2 } = CURVE;
      if (p3.is0())
        throw new Error("bad point: ZERO");
      const { ex: X, ey: Y2, ez: Z, et: T3 } = p3;
      const X2 = modP(X * X);
      const Y22 = modP(Y2 * Y2);
      const Z2 = modP(Z * Z);
      const Z4 = modP(Z2 * Z2);
      const aX2 = modP(X2 * a);
      const left = modP(Z2 * modP(aX2 + Y22));
      const right = modP(Z4 + modP(d2 * modP(X2 * Y22)));
      if (left !== right)
        throw new Error("bad point: equation left != right (1)");
      const XY = modP(X * Y2);
      const ZT = modP(Z * T3);
      if (XY !== ZT)
        throw new Error("bad point: equation left != right (2)");
      return true;
    });
    class Point {
      constructor(ex, ey, ez, et) {
        this.ex = ex;
        this.ey = ey;
        this.ez = ez;
        this.et = et;
        aCoordinate("x", ex);
        aCoordinate("y", ey);
        aCoordinate("z", ez);
        aCoordinate("t", et);
        Object.freeze(this);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      static fromAffine(p3) {
        if (p3 instanceof Point)
          throw new Error("extended point not allowed");
        const { x: x5, y } = p3 || {};
        aCoordinate("x", x5);
        aCoordinate("y", y);
        return new Point(x5, y, _1n8, modP(x5 * y));
      }
      static normalizeZ(points) {
        const toInv = Fp4.invertBatch(points.map((p3) => p3.ez));
        return points.map((p3, i) => p3.toAffine(toInv[i])).map(Point.fromAffine);
      }
      // Multiscalar Multiplication
      static msm(points, scalars) {
        return pippenger(Point, Fn, points, scalars);
      }
      // "Private method", don't use it directly
      _setWindowSize(windowSize) {
        wnaf.setWindowSize(this, windowSize);
      }
      // Not required for fromHex(), which always creates valid points.
      // Could be useful for fromAffine().
      assertValidity() {
        assertValidMemo(this);
      }
      // Compare one point to another.
      equals(other) {
        assertPoint(other);
        const { ex: X1, ey: Y1, ez: Z1 } = this;
        const { ex: X2, ey: Y2, ez: Z2 } = other;
        const X1Z2 = modP(X1 * Z2);
        const X2Z1 = modP(X2 * Z1);
        const Y1Z2 = modP(Y1 * Z2);
        const Y2Z1 = modP(Y2 * Z1);
        return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      negate() {
        return new Point(modP(-this.ex), this.ey, this.ez, modP(-this.et));
      }
      // Fast algo for doubling Extended Point.
      // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
      // Cost: 4M + 4S + 1*a + 6add + 1*2.
      double() {
        const { a } = CURVE;
        const { ex: X1, ey: Y1, ez: Z1 } = this;
        const A2 = modP(X1 * X1);
        const B2 = modP(Y1 * Y1);
        const C2 = modP(_2n7 * modP(Z1 * Z1));
        const D2 = modP(a * A2);
        const x1y1 = X1 + Y1;
        const E2 = modP(modP(x1y1 * x1y1) - A2 - B2);
        const G3 = D2 + B2;
        const F = G3 - C2;
        const H = D2 - B2;
        const X3 = modP(E2 * F);
        const Y3 = modP(G3 * H);
        const T3 = modP(E2 * H);
        const Z3 = modP(F * G3);
        return new Point(X3, Y3, Z3, T3);
      }
      // Fast algo for adding 2 Extended Points.
      // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
      // Cost: 9M + 1*a + 1*d + 7add.
      add(other) {
        assertPoint(other);
        const { a, d: d2 } = CURVE;
        const { ex: X1, ey: Y1, ez: Z1, et: T1 } = this;
        const { ex: X2, ey: Y2, ez: Z2, et: T22 } = other;
        if (a === BigInt(-1)) {
          const A3 = modP((Y1 - X1) * (Y2 + X2));
          const B3 = modP((Y1 + X1) * (Y2 - X2));
          const F2 = modP(B3 - A3);
          if (F2 === _0n8)
            return this.double();
          const C3 = modP(Z1 * _2n7 * T22);
          const D3 = modP(T1 * _2n7 * Z2);
          const E3 = D3 + C3;
          const G4 = B3 + A3;
          const H2 = D3 - C3;
          const X32 = modP(E3 * F2);
          const Y32 = modP(G4 * H2);
          const T32 = modP(E3 * H2);
          const Z32 = modP(F2 * G4);
          return new Point(X32, Y32, Z32, T32);
        }
        const A2 = modP(X1 * X2);
        const B2 = modP(Y1 * Y2);
        const C2 = modP(T1 * d2 * T22);
        const D2 = modP(Z1 * Z2);
        const E2 = modP((X1 + Y1) * (X2 + Y2) - A2 - B2);
        const F = D2 - C2;
        const G3 = D2 + C2;
        const H = modP(B2 - a * A2);
        const X3 = modP(E2 * F);
        const Y3 = modP(G3 * H);
        const T3 = modP(E2 * H);
        const Z3 = modP(F * G3);
        return new Point(X3, Y3, Z3, T3);
      }
      subtract(other) {
        return this.add(other.negate());
      }
      wNAF(n2) {
        return wnaf.wNAFCached(this, n2, Point.normalizeZ);
      }
      // Constant-time multiplication.
      multiply(scalar) {
        const n2 = scalar;
        aInRange("scalar", n2, _1n8, CURVE_ORDER);
        const { p: p3, f: f4 } = this.wNAF(n2);
        return Point.normalizeZ([p3, f4])[0];
      }
      // Non-constant-time multiplication. Uses double-and-add algorithm.
      // It's faster, but should only be used when you don't care about
      // an exposed private key e.g. sig verification.
      // Does NOT allow scalars higher than CURVE.n.
      // Accepts optional accumulator to merge with multiply (important for sparse scalars)
      multiplyUnsafe(scalar, acc = Point.ZERO) {
        const n2 = scalar;
        aInRange("scalar", n2, _0n8, CURVE_ORDER);
        if (n2 === _0n8)
          return I2;
        if (this.is0() || n2 === _1n8)
          return this;
        return wnaf.wNAFCachedUnsafe(this, n2, Point.normalizeZ, acc);
      }
      // Checks if point is of small order.
      // If you add something to small order point, you will have "dirty"
      // point with torsion component.
      // Multiplies point by cofactor and checks if the result is 0.
      isSmallOrder() {
        return this.multiplyUnsafe(cofactor).is0();
      }
      // Multiplies point by curve order and checks if the result is 0.
      // Returns `false` is the point is dirty.
      isTorsionFree() {
        return wnaf.unsafeLadder(this, CURVE_ORDER).is0();
      }
      // Converts Extended point to default (x, y) coordinates.
      // Can accept precomputed Z^-1 - for example, from invertBatch.
      toAffine(iz) {
        return toAffineMemo(this, iz);
      }
      clearCofactor() {
        const { h: cofactor2 } = CURVE;
        if (cofactor2 === _1n8)
          return this;
        return this.multiplyUnsafe(cofactor2);
      }
      // Converts hash string or Uint8Array to Point.
      // Uses algo from RFC8032 5.1.3.
      static fromHex(hex, zip215 = false) {
        const { d: d2, a } = CURVE;
        const len = Fp4.BYTES;
        hex = ensureBytes("pointHex", hex, len);
        abool("zip215", zip215);
        const normed = hex.slice();
        const lastByte = hex[len - 1];
        normed[len - 1] = lastByte & ~128;
        const y = bytesToNumberLE(normed);
        const max = zip215 ? MASK : Fp4.ORDER;
        aInRange("pointHex.y", y, _0n8, max);
        const y2 = modP(y * y);
        const u2 = modP(y2 - _1n8);
        const v2 = modP(d2 * y2 - a);
        let { isValid, value: x5 } = uvRatio2(u2, v2);
        if (!isValid)
          throw new Error("Point.fromHex: invalid y coordinate");
        const isXOdd = (x5 & _1n8) === _1n8;
        const isLastByteOdd = (lastByte & 128) !== 0;
        if (!zip215 && x5 === _0n8 && isLastByteOdd)
          throw new Error("Point.fromHex: x=0 and x_0=1");
        if (isLastByteOdd !== isXOdd)
          x5 = modP(-x5);
        return Point.fromAffine({ x: x5, y });
      }
      static fromPrivateKey(privKey) {
        return getExtendedPublicKey(privKey).point;
      }
      toRawBytes() {
        const { x: x5, y } = this.toAffine();
        const bytes = numberToBytesLE(y, Fp4.BYTES);
        bytes[bytes.length - 1] |= x5 & _1n8 ? 128 : 0;
        return bytes;
      }
      toHex() {
        return bytesToHex(this.toRawBytes());
      }
    }
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n8, modP(CURVE.Gx * CURVE.Gy));
    Point.ZERO = new Point(_0n8, _1n8, _1n8, _0n8);
    const { BASE: G2, ZERO: I2 } = Point;
    const wnaf = wNAF(Point, nByteLength * 8);
    function modN(a) {
      return mod(a, CURVE_ORDER);
    }
    function modN_LE(hash2) {
      return modN(bytesToNumberLE(hash2));
    }
    function getExtendedPublicKey(key) {
      const len = Fp4.BYTES;
      key = ensureBytes("private key", key, len);
      const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
      const head = adjustScalarBytes2(hashed.slice(0, len));
      const prefix = hashed.slice(len, 2 * len);
      const scalar = modN_LE(head);
      const point = G2.multiply(scalar);
      const pointBytes = point.toRawBytes();
      return { head, prefix, scalar, point, pointBytes };
    }
    function getPublicKey(privKey) {
      return getExtendedPublicKey(privKey).pointBytes;
    }
    function hashDomainToScalar(context = new Uint8Array(), ...msgs) {
      const msg = concatBytes(...msgs);
      return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
    }
    function sign(msg, privKey, options = {}) {
      msg = ensureBytes("message", msg);
      if (prehash)
        msg = prehash(msg);
      const { prefix, scalar, pointBytes } = getExtendedPublicKey(privKey);
      const r = hashDomainToScalar(options.context, prefix, msg);
      const R2 = G2.multiply(r).toRawBytes();
      const k2 = hashDomainToScalar(options.context, R2, pointBytes, msg);
      const s2 = modN(r + k2 * scalar);
      aInRange("signature.s", s2, _0n8, CURVE_ORDER);
      const res = concatBytes(R2, numberToBytesLE(s2, Fp4.BYTES));
      return ensureBytes("result", res, Fp4.BYTES * 2);
    }
    const verifyOpts = VERIFY_DEFAULT;
    function verify(sig, msg, publicKey, options = verifyOpts) {
      const { context, zip215 } = options;
      const len = Fp4.BYTES;
      sig = ensureBytes("signature", sig, 2 * len);
      msg = ensureBytes("message", msg);
      publicKey = ensureBytes("publicKey", publicKey, len);
      if (zip215 !== void 0)
        abool("zip215", zip215);
      if (prehash)
        msg = prehash(msg);
      const s2 = bytesToNumberLE(sig.slice(len, 2 * len));
      let A2, R2, SB;
      try {
        A2 = Point.fromHex(publicKey, zip215);
        R2 = Point.fromHex(sig.slice(0, len), zip215);
        SB = G2.multiplyUnsafe(s2);
      } catch (error) {
        return false;
      }
      if (!zip215 && A2.isSmallOrder())
        return false;
      const k2 = hashDomainToScalar(context, R2.toRawBytes(), A2.toRawBytes(), msg);
      const RkA = R2.add(A2.multiplyUnsafe(k2));
      return RkA.subtract(SB).clearCofactor().equals(Point.ZERO);
    }
    G2._setWindowSize(8);
    const utils = {
      getExtendedPublicKey,
      // ed25519 private keys are uniform 32b. No need to check for modulo bias, like in secp256k1.
      randomPrivateKey: () => randomBytes2(Fp4.BYTES),
      /**
       * We're doing scalar multiplication (used in getPublicKey etc) with precomputed BASE_POINT
       * values. This slows down first getPublicKey() by milliseconds (see Speed section),
       * but allows to speed-up subsequent getPublicKey() calls up to 20x.
       * @param windowSize 2, 4, 8, 16
       */
      precompute(windowSize = 8, point = Point.BASE) {
        point._setWindowSize(windowSize);
        point.multiply(BigInt(3));
        return point;
      }
    };
    return {
      CURVE,
      getPublicKey,
      sign,
      verify,
      ExtendedPoint: Point,
      utils
    };
  }
  var _0n8, _1n8, _2n7, _8n2, VERIFY_DEFAULT;
  var init_edwards = __esm({
    "node_modules/@noble/curves/esm/abstract/edwards.js"() {
      init_curve();
      init_modular();
      init_utils2();
      init_utils2();
      _0n8 = BigInt(0);
      _1n8 = BigInt(1);
      _2n7 = BigInt(2);
      _8n2 = BigInt(8);
      VERIFY_DEFAULT = { zip215: true };
    }
  });

  // node_modules/@noble/curves/esm/ed25519.js
  function ed25519_pow_2_252_3(x5) {
    const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
    const P2 = ED25519_P;
    const x22 = x5 * x5 % P2;
    const b22 = x22 * x5 % P2;
    const b4 = pow2(b22, _2n8, P2) * b22 % P2;
    const b5 = pow2(b4, _1n9, P2) * x5 % P2;
    const b10 = pow2(b5, _5n2, P2) * b5 % P2;
    const b20 = pow2(b10, _10n, P2) * b10 % P2;
    const b40 = pow2(b20, _20n, P2) * b20 % P2;
    const b80 = pow2(b40, _40n, P2) * b40 % P2;
    const b160 = pow2(b80, _80n, P2) * b80 % P2;
    const b240 = pow2(b160, _80n, P2) * b80 % P2;
    const b250 = pow2(b240, _10n, P2) * b10 % P2;
    const pow_p_5_8 = pow2(b250, _2n8, P2) * x5 % P2;
    return { pow_p_5_8, b2: b22 };
  }
  function adjustScalarBytes(bytes) {
    bytes[0] &= 248;
    bytes[31] &= 127;
    bytes[31] |= 64;
    return bytes;
  }
  function uvRatio(u2, v2) {
    const P2 = ED25519_P;
    const v3 = mod(v2 * v2 * v2, P2);
    const v7 = mod(v3 * v3 * v2, P2);
    const pow3 = ed25519_pow_2_252_3(u2 * v7).pow_p_5_8;
    let x5 = mod(u2 * v3 * pow3, P2);
    const vx2 = mod(v2 * x5 * x5, P2);
    const root1 = x5;
    const root2 = mod(x5 * ED25519_SQRT_M1, P2);
    const useRoot1 = vx2 === u2;
    const useRoot2 = vx2 === mod(-u2, P2);
    const noRoot = vx2 === mod(-u2 * ED25519_SQRT_M1, P2);
    if (useRoot1)
      x5 = root1;
    if (useRoot2 || noRoot)
      x5 = root2;
    if (isNegativeLE(x5, P2))
      x5 = mod(-x5, P2);
    return { isValid: useRoot1 || useRoot2, value: x5 };
  }
  var ED25519_P, ED25519_SQRT_M1, _0n9, _1n9, _2n8, _3n6, _5n2, _8n3, Fp3, ed25519Defaults, ed25519;
  var init_ed25519 = __esm({
    "node_modules/@noble/curves/esm/ed25519.js"() {
      init_sha512();
      init_utils();
      init_edwards();
      init_modular();
      ED25519_P = BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819949");
      ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
      _0n9 = BigInt(0);
      _1n9 = BigInt(1);
      _2n8 = BigInt(2);
      _3n6 = BigInt(3);
      _5n2 = BigInt(5);
      _8n3 = BigInt(8);
      Fp3 = /* @__PURE__ */ (() => Field(ED25519_P, void 0, true))();
      ed25519Defaults = /* @__PURE__ */ (() => ({
        // Param: a
        a: BigInt(-1),
        // Fp.create(-1) is proper; our way still works and is faster
        // d is equal to -121665/121666 over finite field.
        // Negative number is P - number, and division is invert(number, P)
        d: BigInt("37095705934669439343138083508754565189542113879843219016388785533085940283555"),
        // Finite field 𝔽p over which we'll do calculations; 2n**255n - 19n
        Fp: Fp3,
        // Subgroup order: how many points curve has
        // 2n**252n + 27742317777372353535851937790883648493n;
        n: BigInt("7237005577332262213973186563042994240857116359379907606001950938285454250989"),
        // Cofactor
        h: _8n3,
        // Base point (x, y) aka generator point
        Gx: BigInt("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
        Gy: BigInt("46316835694926478169428394003475163141307993866256225615783033603165251855960"),
        hash: sha512,
        randomBytes,
        adjustScalarBytes,
        // dom2
        // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
        // Constant-time, u/√v
        uvRatio
      }))();
      ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
    }
  });

  // node_modules/@dfinity/agent/lib/esm/utils/expirableMap.js
  var __classPrivateFieldSet, __classPrivateFieldGet, _ExpirableMap_inner, _ExpirableMap_expirationTime, _a, _b, ExpirableMap;
  var init_expirableMap = __esm({
    "node_modules/@dfinity/agent/lib/esm/utils/expirableMap.js"() {
      __classPrivateFieldSet = function(receiver, state, value4, kind, f4) {
        if (kind === "m")
          throw new TypeError("Private method is not writable");
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a setter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
      };
      __classPrivateFieldGet = function(receiver, state, kind, f4) {
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a getter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
      };
      ExpirableMap = class {
        /**
         * Create a new ExpirableMap.
         * @param {ExpirableMapOptions<any, any>} options - options for the map.
         * @param {Iterable<[any, any]>} options.source - an optional source of entries to initialize the map with.
         * @param {number} options.expirationTime - the time in milliseconds after which entries will expire.
         */
        constructor(options = {}) {
          _ExpirableMap_inner.set(this, void 0);
          _ExpirableMap_expirationTime.set(this, void 0);
          this[_a] = this.entries.bind(this);
          this[_b] = "ExpirableMap";
          const { source = [], expirationTime = 10 * 60 * 1e3 } = options;
          const currentTime = Date.now();
          __classPrivateFieldSet(this, _ExpirableMap_inner, new Map([...source].map(([key, value4]) => [key, { value: value4, timestamp: currentTime }])), "f");
          __classPrivateFieldSet(this, _ExpirableMap_expirationTime, expirationTime, "f");
        }
        /**
         * Prune removes all expired entries.
         */
        prune() {
          const currentTime = Date.now();
          for (const [key, entry] of __classPrivateFieldGet(this, _ExpirableMap_inner, "f").entries()) {
            if (currentTime - entry.timestamp > __classPrivateFieldGet(this, _ExpirableMap_expirationTime, "f")) {
              __classPrivateFieldGet(this, _ExpirableMap_inner, "f").delete(key);
            }
          }
          return this;
        }
        // Implementing the Map interface
        /**
         * Set the value for the given key. Prunes expired entries.
         * @param key for the entry
         * @param value of the entry
         * @returns this
         */
        set(key, value4) {
          this.prune();
          const entry = {
            value: value4,
            timestamp: Date.now()
          };
          __classPrivateFieldGet(this, _ExpirableMap_inner, "f").set(key, entry);
          return this;
        }
        /**
         * Get the value associated with the key, if it exists and has not expired.
         * @param key K
         * @returns the value associated with the key, or undefined if the key is not present or has expired.
         */
        get(key) {
          const entry = __classPrivateFieldGet(this, _ExpirableMap_inner, "f").get(key);
          if (entry === void 0) {
            return void 0;
          }
          if (Date.now() - entry.timestamp > __classPrivateFieldGet(this, _ExpirableMap_expirationTime, "f")) {
            __classPrivateFieldGet(this, _ExpirableMap_inner, "f").delete(key);
            return void 0;
          }
          return entry.value;
        }
        /**
         * Clear all entries.
         */
        clear() {
          __classPrivateFieldGet(this, _ExpirableMap_inner, "f").clear();
        }
        /**
         * Entries returns the entries of the map, without the expiration time.
         * @returns an iterator over the entries of the map.
         */
        entries() {
          const iterator = __classPrivateFieldGet(this, _ExpirableMap_inner, "f").entries();
          const generator = function* () {
            for (const [key, value4] of iterator) {
              yield [key, value4.value];
            }
          };
          return generator();
        }
        /**
         * Values returns the values of the map, without the expiration time.
         * @returns an iterator over the values of the map.
         */
        values() {
          const iterator = __classPrivateFieldGet(this, _ExpirableMap_inner, "f").values();
          const generator = function* () {
            for (const value4 of iterator) {
              yield value4.value;
            }
          };
          return generator();
        }
        /**
         * Keys returns the keys of the map
         * @returns an iterator over the keys of the map.
         */
        keys() {
          return __classPrivateFieldGet(this, _ExpirableMap_inner, "f").keys();
        }
        /**
         * forEach calls the callbackfn on each entry of the map.
         * @param callbackfn to call on each entry
         * @param thisArg to use as this when calling the callbackfn
         */
        forEach(callbackfn, thisArg) {
          for (const [key, value4] of __classPrivateFieldGet(this, _ExpirableMap_inner, "f").entries()) {
            callbackfn.call(thisArg, value4.value, key, this);
          }
        }
        /**
         * has returns true if the key exists and has not expired.
         * @param key K
         * @returns true if the key exists and has not expired.
         */
        has(key) {
          return __classPrivateFieldGet(this, _ExpirableMap_inner, "f").has(key);
        }
        /**
         * delete the entry for the given key.
         * @param key K
         * @returns true if the key existed and has been deleted.
         */
        delete(key) {
          return __classPrivateFieldGet(this, _ExpirableMap_inner, "f").delete(key);
        }
        /**
         * get size of the map.
         * @returns the size of the map.
         */
        get size() {
          return __classPrivateFieldGet(this, _ExpirableMap_inner, "f").size;
        }
      };
      _ExpirableMap_inner = /* @__PURE__ */ new WeakMap(), _ExpirableMap_expirationTime = /* @__PURE__ */ new WeakMap(), _a = Symbol.iterator, _b = Symbol.toStringTag;
    }
  });

  // node_modules/@dfinity/agent/lib/esm/der.js
  function wrapDER(payload, oid) {
    const bitStringHeaderLength = 2 + encodeLenBytes(payload.byteLength + 1);
    const len = oid.byteLength + bitStringHeaderLength + payload.byteLength;
    let offset = 0;
    const buf = new Uint8Array(1 + encodeLenBytes(len) + len);
    buf[offset++] = 48;
    offset += encodeLen(buf, offset, len);
    buf.set(oid, offset);
    offset += oid.byteLength;
    buf[offset++] = 3;
    offset += encodeLen(buf, offset, payload.byteLength + 1);
    buf[offset++] = 0;
    buf.set(new Uint8Array(payload), offset);
    return buf;
  }
  var encodeLenBytes, encodeLen, decodeLenBytes, decodeLen, DER_COSE_OID, ED25519_OID, SECP256K1_OID, unwrapDER;
  var init_der = __esm({
    "node_modules/@dfinity/agent/lib/esm/der.js"() {
      init_buffer();
      encodeLenBytes = (len) => {
        if (len <= 127) {
          return 1;
        } else if (len <= 255) {
          return 2;
        } else if (len <= 65535) {
          return 3;
        } else if (len <= 16777215) {
          return 4;
        } else {
          throw new Error("Length too long (> 4 bytes)");
        }
      };
      encodeLen = (buf, offset, len) => {
        if (len <= 127) {
          buf[offset] = len;
          return 1;
        } else if (len <= 255) {
          buf[offset] = 129;
          buf[offset + 1] = len;
          return 2;
        } else if (len <= 65535) {
          buf[offset] = 130;
          buf[offset + 1] = len >> 8;
          buf[offset + 2] = len;
          return 3;
        } else if (len <= 16777215) {
          buf[offset] = 131;
          buf[offset + 1] = len >> 16;
          buf[offset + 2] = len >> 8;
          buf[offset + 3] = len;
          return 4;
        } else {
          throw new Error("Length too long (> 4 bytes)");
        }
      };
      decodeLenBytes = (buf, offset) => {
        if (buf[offset] < 128)
          return 1;
        if (buf[offset] === 128)
          throw new Error("Invalid length 0");
        if (buf[offset] === 129)
          return 2;
        if (buf[offset] === 130)
          return 3;
        if (buf[offset] === 131)
          return 4;
        throw new Error("Length too long (> 4 bytes)");
      };
      decodeLen = (buf, offset) => {
        const lenBytes = decodeLenBytes(buf, offset);
        if (lenBytes === 1)
          return buf[offset];
        else if (lenBytes === 2)
          return buf[offset + 1];
        else if (lenBytes === 3)
          return (buf[offset + 1] << 8) + buf[offset + 2];
        else if (lenBytes === 4)
          return (buf[offset + 1] << 16) + (buf[offset + 2] << 8) + buf[offset + 3];
        throw new Error("Length too long (> 4 bytes)");
      };
      DER_COSE_OID = Uint8Array.from([
        ...[48, 12],
        ...[6, 10],
        ...[43, 6, 1, 4, 1, 131, 184, 67, 1, 1]
        // DER encoded COSE
      ]);
      ED25519_OID = Uint8Array.from([
        ...[48, 5],
        ...[6, 3],
        ...[43, 101, 112]
        // id-Ed25519 OID
      ]);
      SECP256K1_OID = Uint8Array.from([
        ...[48, 16],
        ...[6, 7],
        ...[42, 134, 72, 206, 61, 2, 1],
        ...[6, 5],
        ...[43, 129, 4, 0, 10]
        // OID secp256k1
      ]);
      unwrapDER = (derEncoded, oid) => {
        let offset = 0;
        const expect = (n2, msg) => {
          if (buf[offset++] !== n2) {
            throw new Error("Expected: " + msg);
          }
        };
        const buf = new Uint8Array(derEncoded);
        expect(48, "sequence");
        offset += decodeLenBytes(buf, offset);
        if (!bufEquals(buf.slice(offset, offset + oid.byteLength), oid)) {
          throw new Error("Not the expected OID.");
        }
        offset += oid.byteLength;
        expect(3, "bit string");
        const payloadLen = decodeLen(buf, offset) - 1;
        offset += decodeLenBytes(buf, offset);
        expect(0, "0 padding");
        const result = buf.slice(offset);
        if (payloadLen !== result.length) {
          throw new Error(`DER payload mismatch: Expected length ${payloadLen} actual length ${result.length}`);
        }
        return result;
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/public_key.js
  var __classPrivateFieldSet2, __classPrivateFieldGet2, _Ed25519PublicKey_rawKey, _Ed25519PublicKey_derKey, Ed25519PublicKey;
  var init_public_key = __esm({
    "node_modules/@dfinity/agent/lib/esm/public_key.js"() {
      init_der();
      __classPrivateFieldSet2 = function(receiver, state, value4, kind, f4) {
        if (kind === "m")
          throw new TypeError("Private method is not writable");
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a setter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
      };
      __classPrivateFieldGet2 = function(receiver, state, kind, f4) {
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a getter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
      };
      Ed25519PublicKey = class _Ed25519PublicKey {
        // `fromRaw` and `fromDer` should be used for instantiation, not this constructor.
        constructor(key) {
          _Ed25519PublicKey_rawKey.set(this, void 0);
          _Ed25519PublicKey_derKey.set(this, void 0);
          if (key.byteLength !== _Ed25519PublicKey.RAW_KEY_LENGTH) {
            throw new Error("An Ed25519 public key must be exactly 32bytes long");
          }
          __classPrivateFieldSet2(this, _Ed25519PublicKey_rawKey, key, "f");
          __classPrivateFieldSet2(this, _Ed25519PublicKey_derKey, _Ed25519PublicKey.derEncode(key), "f");
        }
        static from(key) {
          return this.fromDer(key.toDer());
        }
        static fromRaw(rawKey) {
          return new _Ed25519PublicKey(rawKey);
        }
        static fromDer(derKey) {
          return new _Ed25519PublicKey(this.derDecode(derKey));
        }
        static derEncode(publicKey) {
          return wrapDER(publicKey, ED25519_OID).buffer;
        }
        static derDecode(key) {
          const unwrapped = unwrapDER(key, ED25519_OID);
          if (unwrapped.length !== this.RAW_KEY_LENGTH) {
            throw new Error("An Ed25519 public key must be exactly 32bytes long");
          }
          return unwrapped;
        }
        get rawKey() {
          return __classPrivateFieldGet2(this, _Ed25519PublicKey_rawKey, "f");
        }
        get derKey() {
          return __classPrivateFieldGet2(this, _Ed25519PublicKey_derKey, "f");
        }
        toDer() {
          return this.derKey;
        }
        toRaw() {
          return this.rawKey;
        }
      };
      _Ed25519PublicKey_rawKey = /* @__PURE__ */ new WeakMap(), _Ed25519PublicKey_derKey = /* @__PURE__ */ new WeakMap();
      Ed25519PublicKey.RAW_KEY_LENGTH = 32;
    }
  });

  // node_modules/@dfinity/agent/lib/esm/observable.js
  var Observable, ObservableLog;
  var init_observable = __esm({
    "node_modules/@dfinity/agent/lib/esm/observable.js"() {
      Observable = class {
        constructor() {
          this.observers = [];
        }
        subscribe(func) {
          this.observers.push(func);
        }
        unsubscribe(func) {
          this.observers = this.observers.filter((observer) => observer !== func);
        }
        notify(data, ...rest) {
          this.observers.forEach((observer) => observer(data, ...rest));
        }
      };
      ObservableLog = class extends Observable {
        constructor() {
          super();
        }
        print(message, ...rest) {
          this.notify({ message, level: "info" }, ...rest);
        }
        warn(message, ...rest) {
          this.notify({ message, level: "warn" }, ...rest);
        }
        error(message, error, ...rest) {
          this.notify({ message, level: "error", error }, ...rest);
        }
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/polling/backoff.js
  var __classPrivateFieldSet3, __classPrivateFieldGet3, _ExponentialBackoff_currentInterval, _ExponentialBackoff_randomizationFactor, _ExponentialBackoff_multiplier, _ExponentialBackoff_maxInterval, _ExponentialBackoff_startTime, _ExponentialBackoff_maxElapsedTime, _ExponentialBackoff_maxIterations, _ExponentialBackoff_date, _ExponentialBackoff_count, RANDOMIZATION_FACTOR, MULTIPLIER, INITIAL_INTERVAL_MSEC, MAX_INTERVAL_MSEC, MAX_ELAPSED_TIME_MSEC, MAX_ITERATIONS, ExponentialBackoff;
  var init_backoff = __esm({
    "node_modules/@dfinity/agent/lib/esm/polling/backoff.js"() {
      __classPrivateFieldSet3 = function(receiver, state, value4, kind, f4) {
        if (kind === "m")
          throw new TypeError("Private method is not writable");
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a setter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
      };
      __classPrivateFieldGet3 = function(receiver, state, kind, f4) {
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a getter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
      };
      RANDOMIZATION_FACTOR = 0.5;
      MULTIPLIER = 1.5;
      INITIAL_INTERVAL_MSEC = 500;
      MAX_INTERVAL_MSEC = 6e4;
      MAX_ELAPSED_TIME_MSEC = 9e5;
      MAX_ITERATIONS = 10;
      ExponentialBackoff = class _ExponentialBackoff {
        constructor(options = _ExponentialBackoff.default) {
          _ExponentialBackoff_currentInterval.set(this, void 0);
          _ExponentialBackoff_randomizationFactor.set(this, void 0);
          _ExponentialBackoff_multiplier.set(this, void 0);
          _ExponentialBackoff_maxInterval.set(this, void 0);
          _ExponentialBackoff_startTime.set(this, void 0);
          _ExponentialBackoff_maxElapsedTime.set(this, void 0);
          _ExponentialBackoff_maxIterations.set(this, void 0);
          _ExponentialBackoff_date.set(this, void 0);
          _ExponentialBackoff_count.set(this, 0);
          const { initialInterval = INITIAL_INTERVAL_MSEC, randomizationFactor = RANDOMIZATION_FACTOR, multiplier = MULTIPLIER, maxInterval = MAX_INTERVAL_MSEC, maxElapsedTime = MAX_ELAPSED_TIME_MSEC, maxIterations = MAX_ITERATIONS, date = Date } = options;
          __classPrivateFieldSet3(this, _ExponentialBackoff_currentInterval, initialInterval, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_randomizationFactor, randomizationFactor, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_multiplier, multiplier, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_maxInterval, maxInterval, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_date, date, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_startTime, date.now(), "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_maxElapsedTime, maxElapsedTime, "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_maxIterations, maxIterations, "f");
        }
        get ellapsedTimeInMsec() {
          return __classPrivateFieldGet3(this, _ExponentialBackoff_date, "f").now() - __classPrivateFieldGet3(this, _ExponentialBackoff_startTime, "f");
        }
        get currentInterval() {
          return __classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f");
        }
        get count() {
          return __classPrivateFieldGet3(this, _ExponentialBackoff_count, "f");
        }
        get randomValueFromInterval() {
          const delta = __classPrivateFieldGet3(this, _ExponentialBackoff_randomizationFactor, "f") * __classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f");
          const min = __classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f") - delta;
          const max = __classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f") + delta;
          return Math.random() * (max - min) + min;
        }
        incrementCurrentInterval() {
          var _a2;
          __classPrivateFieldSet3(this, _ExponentialBackoff_currentInterval, Math.min(__classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f") * __classPrivateFieldGet3(this, _ExponentialBackoff_multiplier, "f"), __classPrivateFieldGet3(this, _ExponentialBackoff_maxInterval, "f")), "f");
          __classPrivateFieldSet3(this, _ExponentialBackoff_count, (_a2 = __classPrivateFieldGet3(this, _ExponentialBackoff_count, "f"), _a2++, _a2), "f");
          return __classPrivateFieldGet3(this, _ExponentialBackoff_currentInterval, "f");
        }
        next() {
          if (this.ellapsedTimeInMsec >= __classPrivateFieldGet3(this, _ExponentialBackoff_maxElapsedTime, "f") || __classPrivateFieldGet3(this, _ExponentialBackoff_count, "f") >= __classPrivateFieldGet3(this, _ExponentialBackoff_maxIterations, "f")) {
            return null;
          } else {
            this.incrementCurrentInterval();
            return this.randomValueFromInterval;
          }
        }
      };
      _ExponentialBackoff_currentInterval = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_randomizationFactor = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_multiplier = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_maxInterval = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_startTime = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_maxElapsedTime = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_maxIterations = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_date = /* @__PURE__ */ new WeakMap(), _ExponentialBackoff_count = /* @__PURE__ */ new WeakMap();
      ExponentialBackoff.default = {
        initialInterval: INITIAL_INTERVAL_MSEC,
        randomizationFactor: RANDOMIZATION_FACTOR,
        multiplier: MULTIPLIER,
        maxInterval: MAX_INTERVAL_MSEC,
        // 1 minute
        maxElapsedTime: MAX_ELAPSED_TIME_MSEC,
        maxIterations: MAX_ITERATIONS,
        date: Date
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/constants.js
  var DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS;
  var init_constants = __esm({
    "node_modules/@dfinity/agent/lib/esm/constants.js"() {
      DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS = 5 * 60 * 1e3;
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/http/index.js
  function getDefaultFetch() {
    let defaultFetch;
    if (typeof window !== "undefined") {
      if (window.fetch) {
        defaultFetch = window.fetch.bind(window);
      } else {
        throw new HttpDefaultFetchError("Fetch implementation was not available. You appear to be in a browser context, but window.fetch was not present.");
      }
    } else if (typeof window !== "undefined") {
      if (window.fetch) {
        defaultFetch = window.fetch.bind(window);
      } else {
        throw new HttpDefaultFetchError("Fetch implementation was not available. You appear to be in a Node.js context, but global.fetch was not available.");
      }
    } else if (typeof self !== "undefined") {
      if (self.fetch) {
        defaultFetch = self.fetch.bind(self);
      }
    }
    if (defaultFetch) {
      return defaultFetch;
    }
    throw new HttpDefaultFetchError("Fetch implementation was not available. Please provide fetch to the HttpAgent constructor, or ensure it is available in the window or global context.");
  }
  function determineHost(configuredHost) {
    let host;
    if (configuredHost !== void 0) {
      if (!configuredHost.match(/^[a-z]+:/) && typeof window !== "undefined") {
        host = new URL(window.location.protocol + "//" + configuredHost);
      } else {
        host = new URL(configuredHost);
      }
    } else {
      const knownHosts = ["ic0.app", "icp0.io", "127.0.0.1", "localhost"];
      const remoteHosts = [".github.dev", ".gitpod.io"];
      const location2 = typeof window !== "undefined" ? window.location : void 0;
      const hostname = location2 === null || location2 === void 0 ? void 0 : location2.hostname;
      let knownHost;
      if (hostname && typeof hostname === "string") {
        if (remoteHosts.some((host2) => hostname.endsWith(host2))) {
          knownHost = hostname;
        } else {
          knownHost = knownHosts.find((host2) => hostname.endsWith(host2));
        }
      }
      if (location2 && knownHost) {
        host = new URL(`${location2.protocol}//${knownHost}${location2.port ? ":" + location2.port : ""}`);
      } else {
        host = new URL("https://icp-api.io");
      }
    }
    return host.toString();
  }
  var __classPrivateFieldSet4, __classPrivateFieldGet4, _HttpAgent_instances, _HttpAgent_identity, _HttpAgent_fetch, _HttpAgent_fetchOptions, _HttpAgent_callOptions, _HttpAgent_timeDiffMsecs, _HttpAgent_credentials, _HttpAgent_rootKeyFetched, _HttpAgent_retryTimes, _HttpAgent_backoffStrategy, _HttpAgent_maxIngressExpiryInMinutes, _HttpAgent_waterMark, _HttpAgent_queryPipeline, _HttpAgent_updatePipeline, _HttpAgent_subnetKeys, _HttpAgent_verifyQuerySignatures, _HttpAgent_requestAndRetryQuery, _HttpAgent_requestAndRetry, _HttpAgent_verifyQueryResponse, RequestStatusResponseStatus, MINUTE_TO_MSECS, IC_ROOT_KEY, MANAGEMENT_CANISTER_ID, IC0_DOMAIN, IC0_SUB_DOMAIN, ICP0_DOMAIN, ICP0_SUB_DOMAIN, ICP_API_DOMAIN, ICP_API_SUB_DOMAIN, HttpDefaultFetchError, IdentityInvalidError, HttpAgent;
  var init_http = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/http/index.js"() {
      init_esm();
      init_errors();
      init_auth();
      init_cbor();
      init_request_id();
      init_buffer();
      init_transforms();
      init_types2();
      init_errors2();
      init_canisterStatus();
      init_certificate();
      init_ed25519();
      init_expirableMap();
      init_public_key();
      init_leb();
      init_observable();
      init_backoff();
      init_constants();
      init_transforms();
      init_types2();
      __classPrivateFieldSet4 = function(receiver, state, value4, kind, f4) {
        if (kind === "m")
          throw new TypeError("Private method is not writable");
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a setter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot write private member to an object whose class did not declare it");
        return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
      };
      __classPrivateFieldGet4 = function(receiver, state, kind, f4) {
        if (kind === "a" && !f4)
          throw new TypeError("Private accessor was defined without a getter");
        if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
          throw new TypeError("Cannot read private member from an object whose class did not declare it");
        return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
      };
      (function(RequestStatusResponseStatus2) {
        RequestStatusResponseStatus2["Received"] = "received";
        RequestStatusResponseStatus2["Processing"] = "processing";
        RequestStatusResponseStatus2["Replied"] = "replied";
        RequestStatusResponseStatus2["Rejected"] = "rejected";
        RequestStatusResponseStatus2["Unknown"] = "unknown";
        RequestStatusResponseStatus2["Done"] = "done";
      })(RequestStatusResponseStatus || (RequestStatusResponseStatus = {}));
      MINUTE_TO_MSECS = 60 * 1e3;
      IC_ROOT_KEY = "308182301d060d2b0601040182dc7c0503010201060c2b0601040182dc7c05030201036100814c0e6ec71fab583b08bd81373c255c3c371b2e84863c98a4f1e08b74235d14fb5d9c0cd546d9685f913a0c0b2cc5341583bf4b4392e467db96d65b9bb4cb717112f8472e0d5a4d14505ffd7484b01291091c5f87b98883463f98091a0baaae";
      MANAGEMENT_CANISTER_ID = "aaaaa-aa";
      IC0_DOMAIN = "ic0.app";
      IC0_SUB_DOMAIN = ".ic0.app";
      ICP0_DOMAIN = "icp0.io";
      ICP0_SUB_DOMAIN = ".icp0.io";
      ICP_API_DOMAIN = "icp-api.io";
      ICP_API_SUB_DOMAIN = ".icp-api.io";
      HttpDefaultFetchError = class extends AgentError {
        constructor(message) {
          super(message);
          this.message = message;
        }
      };
      IdentityInvalidError = class extends AgentError {
        constructor(message) {
          super(message);
          this.message = message;
        }
      };
      HttpAgent = class _HttpAgent {
        /**
         * @param options - Options for the HttpAgent
         * @deprecated Use `HttpAgent.create` or `HttpAgent.createSync` instead
         */
        constructor(options = {}) {
          var _a2;
          _HttpAgent_instances.add(this);
          _HttpAgent_identity.set(this, void 0);
          _HttpAgent_fetch.set(this, void 0);
          _HttpAgent_fetchOptions.set(this, void 0);
          _HttpAgent_callOptions.set(this, void 0);
          _HttpAgent_timeDiffMsecs.set(this, 0);
          _HttpAgent_credentials.set(this, void 0);
          _HttpAgent_rootKeyFetched.set(this, false);
          _HttpAgent_retryTimes.set(this, void 0);
          _HttpAgent_backoffStrategy.set(this, void 0);
          _HttpAgent_maxIngressExpiryInMinutes.set(this, void 0);
          this._isAgent = true;
          this.config = {};
          _HttpAgent_waterMark.set(this, 0);
          this.log = new ObservableLog();
          _HttpAgent_queryPipeline.set(this, []);
          _HttpAgent_updatePipeline.set(this, []);
          _HttpAgent_subnetKeys.set(this, new ExpirableMap({
            expirationTime: 5 * 60 * 1e3
            // 5 minutes
          }));
          _HttpAgent_verifyQuerySignatures.set(this, true);
          _HttpAgent_verifyQueryResponse.set(this, (queryResponse, subnetStatus) => {
            if (__classPrivateFieldGet4(this, _HttpAgent_verifyQuerySignatures, "f") === false) {
              return queryResponse;
            }
            if (!subnetStatus) {
              throw new CertificateVerificationError("Invalid signature from replica signed query: no matching node key found.");
            }
            const { status, signatures = [], requestId } = queryResponse;
            const domainSeparator3 = new TextEncoder().encode("\vic-response");
            for (const sig of signatures) {
              const { timestamp, identity } = sig;
              const nodeId = Principal.fromUint8Array(identity).toText();
              let hash2;
              if (status === "replied") {
                const { reply } = queryResponse;
                hash2 = hashOfMap({
                  status,
                  reply,
                  timestamp: BigInt(timestamp),
                  request_id: requestId
                });
              } else if (status === "rejected") {
                const { reject_code, reject_message, error_code } = queryResponse;
                hash2 = hashOfMap({
                  status,
                  reject_code,
                  reject_message,
                  error_code,
                  timestamp: BigInt(timestamp),
                  request_id: requestId
                });
              } else {
                throw new Error(`Unknown status: ${status}`);
              }
              const separatorWithHash = concat(domainSeparator3, new Uint8Array(hash2));
              const pubKey = subnetStatus === null || subnetStatus === void 0 ? void 0 : subnetStatus.nodeKeys.get(nodeId);
              if (!pubKey) {
                throw new CertificateVerificationError("Invalid signature from replica signed query: no matching node key found.");
              }
              const rawKey = Ed25519PublicKey.fromDer(pubKey).rawKey;
              const valid = ed25519.verify(sig.signature, new Uint8Array(separatorWithHash), new Uint8Array(rawKey));
              if (valid)
                return queryResponse;
              throw new CertificateVerificationError(`Invalid signature from replica ${nodeId} signed query.`);
            }
            return queryResponse;
          });
          this.config = options;
          __classPrivateFieldSet4(this, _HttpAgent_fetch, options.fetch || getDefaultFetch() || fetch.bind(window), "f");
          __classPrivateFieldSet4(this, _HttpAgent_fetchOptions, options.fetchOptions, "f");
          __classPrivateFieldSet4(this, _HttpAgent_callOptions, options.callOptions, "f");
          this.rootKey = options.rootKey ? options.rootKey : fromHex(IC_ROOT_KEY);
          const host = determineHost(options.host);
          this.host = new URL(host);
          if (options.verifyQuerySignatures !== void 0) {
            __classPrivateFieldSet4(this, _HttpAgent_verifyQuerySignatures, options.verifyQuerySignatures, "f");
          }
          __classPrivateFieldSet4(this, _HttpAgent_retryTimes, (_a2 = options.retryTimes) !== null && _a2 !== void 0 ? _a2 : 3, "f");
          const defaultBackoffFactory = () => new ExponentialBackoff({
            maxIterations: __classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")
          });
          __classPrivateFieldSet4(this, _HttpAgent_backoffStrategy, options.backoffStrategy || defaultBackoffFactory, "f");
          if (this.host.hostname.endsWith(IC0_SUB_DOMAIN)) {
            this.host.hostname = IC0_DOMAIN;
          } else if (this.host.hostname.endsWith(ICP0_SUB_DOMAIN)) {
            this.host.hostname = ICP0_DOMAIN;
          } else if (this.host.hostname.endsWith(ICP_API_SUB_DOMAIN)) {
            this.host.hostname = ICP_API_DOMAIN;
          }
          if (options.credentials) {
            const { name, password } = options.credentials;
            __classPrivateFieldSet4(this, _HttpAgent_credentials, `${name}${password ? ":" + password : ""}`, "f");
          }
          __classPrivateFieldSet4(this, _HttpAgent_identity, Promise.resolve(options.identity || new AnonymousIdentity()), "f");
          if (options.ingressExpiryInMinutes && options.ingressExpiryInMinutes > 5) {
            throw new AgentError(`The maximum ingress expiry time is 5 minutes. Provided ingress expiry time is ${options.ingressExpiryInMinutes} minutes.`);
          }
          if (options.ingressExpiryInMinutes && options.ingressExpiryInMinutes <= 0) {
            throw new AgentError(`Ingress expiry time must be greater than 0. Provided ingress expiry time is ${options.ingressExpiryInMinutes} minutes.`);
          }
          __classPrivateFieldSet4(this, _HttpAgent_maxIngressExpiryInMinutes, options.ingressExpiryInMinutes || 5, "f");
          this.addTransform("update", makeNonceTransform(makeNonce));
          if (options.useQueryNonces) {
            this.addTransform("query", makeNonceTransform(makeNonce));
          }
          if (options.logToConsole) {
            this.log.subscribe((log) => {
              if (log.level === "error") {
                console.error(log.message);
              } else if (log.level === "warn") {
                console.warn(log.message);
              } else {
                console.log(log.message);
              }
            });
          }
        }
        get waterMark() {
          return __classPrivateFieldGet4(this, _HttpAgent_waterMark, "f");
        }
        static createSync(options = {}) {
          return new this(Object.assign({}, options));
        }
        static async create(options = {
          shouldFetchRootKey: false
        }) {
          const agent = _HttpAgent.createSync(options);
          const initPromises = [agent.syncTime()];
          if (agent.host.toString() !== "https://icp-api.io" && options.shouldFetchRootKey) {
            initPromises.push(agent.fetchRootKey());
          }
          await Promise.all(initPromises);
          return agent;
        }
        static async from(agent) {
          var _a2;
          try {
            if ("config" in agent) {
              return await _HttpAgent.create(agent.config);
            }
            return await _HttpAgent.create({
              fetch: agent._fetch,
              fetchOptions: agent._fetchOptions,
              callOptions: agent._callOptions,
              host: agent._host.toString(),
              identity: (_a2 = agent._identity) !== null && _a2 !== void 0 ? _a2 : void 0
            });
          } catch (_b2) {
            throw new AgentError("Failed to create agent from provided agent");
          }
        }
        isLocal() {
          const hostname = this.host.hostname;
          return hostname === "127.0.0.1" || hostname.endsWith("127.0.0.1");
        }
        addTransform(type, fn, priority = fn.priority || 0) {
          if (type === "update") {
            const i = __classPrivateFieldGet4(this, _HttpAgent_updatePipeline, "f").findIndex((x5) => (x5.priority || 0) < priority);
            __classPrivateFieldGet4(this, _HttpAgent_updatePipeline, "f").splice(i >= 0 ? i : __classPrivateFieldGet4(this, _HttpAgent_updatePipeline, "f").length, 0, Object.assign(fn, { priority }));
          } else if (type === "query") {
            const i = __classPrivateFieldGet4(this, _HttpAgent_queryPipeline, "f").findIndex((x5) => (x5.priority || 0) < priority);
            __classPrivateFieldGet4(this, _HttpAgent_queryPipeline, "f").splice(i >= 0 ? i : __classPrivateFieldGet4(this, _HttpAgent_queryPipeline, "f").length, 0, Object.assign(fn, { priority }));
          }
        }
        async getPrincipal() {
          if (!__classPrivateFieldGet4(this, _HttpAgent_identity, "f")) {
            throw new IdentityInvalidError("This identity has expired due this application's security policy. Please refresh your authentication.");
          }
          return (await __classPrivateFieldGet4(this, _HttpAgent_identity, "f")).getPrincipal();
        }
        async call(canisterId, options, identity) {
          var _a2;
          const callSync = (_a2 = options.callSync) !== null && _a2 !== void 0 ? _a2 : true;
          const id = await (identity !== void 0 ? await identity : await __classPrivateFieldGet4(this, _HttpAgent_identity, "f"));
          if (!id) {
            throw new IdentityInvalidError("This identity has expired due this application's security policy. Please refresh your authentication.");
          }
          const canister = Principal.from(canisterId);
          const ecid = options.effectiveCanisterId ? Principal.from(options.effectiveCanisterId) : canister;
          const sender = id.getPrincipal() || Principal.anonymous();
          let ingress_expiry = new Expiry(__classPrivateFieldGet4(this, _HttpAgent_maxIngressExpiryInMinutes, "f") * MINUTE_TO_MSECS);
          if (Math.abs(__classPrivateFieldGet4(this, _HttpAgent_timeDiffMsecs, "f")) > 1e3 * 30) {
            ingress_expiry = new Expiry(__classPrivateFieldGet4(this, _HttpAgent_maxIngressExpiryInMinutes, "f") * MINUTE_TO_MSECS + __classPrivateFieldGet4(this, _HttpAgent_timeDiffMsecs, "f"));
          }
          const submit = {
            request_type: SubmitRequestType.Call,
            canister_id: canister,
            method_name: options.methodName,
            arg: options.arg,
            sender,
            ingress_expiry
          };
          let transformedRequest = await this._transform({
            request: {
              body: null,
              method: "POST",
              headers: Object.assign({ "Content-Type": "application/cbor" }, __classPrivateFieldGet4(this, _HttpAgent_credentials, "f") ? { Authorization: "Basic " + btoa(__classPrivateFieldGet4(this, _HttpAgent_credentials, "f")) } : {})
            },
            endpoint: "call",
            body: submit
          });
          const nonce = transformedRequest.body.nonce ? toNonce(transformedRequest.body.nonce) : void 0;
          submit.nonce = nonce;
          function toNonce(buf) {
            return new Uint8Array(buf);
          }
          transformedRequest = await id.transformRequest(transformedRequest);
          const body = encode3(transformedRequest.body);
          const backoff2 = __classPrivateFieldGet4(this, _HttpAgent_backoffStrategy, "f").call(this);
          try {
            const requestSync = () => {
              this.log.print(`fetching "/api/v3/canister/${ecid.toText()}/call" with request:`, transformedRequest);
              return __classPrivateFieldGet4(this, _HttpAgent_fetch, "f").call(this, "" + new URL(`/api/v3/canister/${ecid.toText()}/call`, this.host), Object.assign(Object.assign(Object.assign({}, __classPrivateFieldGet4(this, _HttpAgent_callOptions, "f")), transformedRequest.request), { body }));
            };
            const requestAsync = () => {
              this.log.print(`fetching "/api/v2/canister/${ecid.toText()}/call" with request:`, transformedRequest);
              return __classPrivateFieldGet4(this, _HttpAgent_fetch, "f").call(this, "" + new URL(`/api/v2/canister/${ecid.toText()}/call`, this.host), Object.assign(Object.assign(Object.assign({}, __classPrivateFieldGet4(this, _HttpAgent_callOptions, "f")), transformedRequest.request), { body }));
            };
            const request2 = __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetry).call(this, {
              request: callSync ? requestSync : requestAsync,
              backoff: backoff2,
              tries: 0
            });
            const requestId = requestIdOf(submit);
            const response = await request2;
            const responseBuffer = await response.arrayBuffer();
            const responseBody = response.status === 200 && responseBuffer.byteLength > 0 ? decode3(responseBuffer) : null;
            if (responseBody && "certificate" in responseBody) {
              const time = await this.parseTimeFromResponse({
                certificate: responseBody.certificate
              });
              __classPrivateFieldSet4(this, _HttpAgent_waterMark, time, "f");
            }
            return {
              requestId,
              response: {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                body: responseBody,
                headers: httpHeadersTransform(response.headers)
              },
              requestDetails: submit
            };
          } catch (error) {
            if (error.message.includes("v3 api not supported.")) {
              this.log.warn("v3 api not supported. Fall back to v2");
              return this.call(canisterId, Object.assign(Object.assign({}, options), {
                // disable v3 api
                callSync: false
              }), identity);
            }
            this.log.error("Error while making call:", error);
            throw error;
          }
        }
        async query(canisterId, fields, identity) {
          const backoff2 = __classPrivateFieldGet4(this, _HttpAgent_backoffStrategy, "f").call(this);
          const ecid = fields.effectiveCanisterId ? Principal.from(fields.effectiveCanisterId) : Principal.from(canisterId);
          this.log.print(`ecid ${ecid.toString()}`);
          this.log.print(`canisterId ${canisterId.toString()}`);
          const makeQuery = async () => {
            const id = await (identity !== void 0 ? identity : __classPrivateFieldGet4(this, _HttpAgent_identity, "f"));
            if (!id) {
              throw new IdentityInvalidError("This identity has expired due this application's security policy. Please refresh your authentication.");
            }
            const canister = Principal.from(canisterId);
            const sender = (id === null || id === void 0 ? void 0 : id.getPrincipal()) || Principal.anonymous();
            const request2 = {
              request_type: "query",
              canister_id: canister,
              method_name: fields.methodName,
              arg: fields.arg,
              sender,
              ingress_expiry: new Expiry(__classPrivateFieldGet4(this, _HttpAgent_maxIngressExpiryInMinutes, "f") * MINUTE_TO_MSECS)
            };
            const requestId = requestIdOf(request2);
            let transformedRequest = await this._transform({
              request: {
                method: "POST",
                headers: Object.assign({ "Content-Type": "application/cbor" }, __classPrivateFieldGet4(this, _HttpAgent_credentials, "f") ? { Authorization: "Basic " + btoa(__classPrivateFieldGet4(this, _HttpAgent_credentials, "f")) } : {})
              },
              endpoint: "read",
              body: request2
            });
            transformedRequest = await (id === null || id === void 0 ? void 0 : id.transformRequest(transformedRequest));
            const body = encode3(transformedRequest.body);
            const args = {
              canister: canister.toText(),
              ecid,
              transformedRequest,
              body,
              requestId,
              backoff: backoff2,
              tries: 0
            };
            return {
              requestDetails: request2,
              query: await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetryQuery).call(this, args)
            };
          };
          const getSubnetStatus = async () => {
            if (!__classPrivateFieldGet4(this, _HttpAgent_verifyQuerySignatures, "f")) {
              return void 0;
            }
            const subnetStatus2 = __classPrivateFieldGet4(this, _HttpAgent_subnetKeys, "f").get(ecid.toString());
            if (subnetStatus2) {
              return subnetStatus2;
            }
            await this.fetchSubnetKeys(ecid.toString());
            return __classPrivateFieldGet4(this, _HttpAgent_subnetKeys, "f").get(ecid.toString());
          };
          const [queryResult, subnetStatus] = await Promise.all([makeQuery(), getSubnetStatus()]);
          const { requestDetails, query } = queryResult;
          const queryWithDetails = Object.assign(Object.assign({}, query), { requestDetails });
          this.log.print("Query response:", queryWithDetails);
          if (!__classPrivateFieldGet4(this, _HttpAgent_verifyQuerySignatures, "f")) {
            return queryWithDetails;
          }
          try {
            return __classPrivateFieldGet4(this, _HttpAgent_verifyQueryResponse, "f").call(this, queryWithDetails, subnetStatus);
          } catch (_a2) {
            this.log.warn("Query response verification failed. Retrying with fresh subnet keys.");
            __classPrivateFieldGet4(this, _HttpAgent_subnetKeys, "f").delete(canisterId.toString());
            await this.fetchSubnetKeys(ecid.toString());
            const updatedSubnetStatus = __classPrivateFieldGet4(this, _HttpAgent_subnetKeys, "f").get(canisterId.toString());
            if (!updatedSubnetStatus) {
              throw new CertificateVerificationError("Invalid signature from replica signed query: no matching node key found.");
            }
            return __classPrivateFieldGet4(this, _HttpAgent_verifyQueryResponse, "f").call(this, queryWithDetails, updatedSubnetStatus);
          }
        }
        async createReadStateRequest(fields, identity) {
          const id = await (identity !== void 0 ? await identity : await __classPrivateFieldGet4(this, _HttpAgent_identity, "f"));
          if (!id) {
            throw new IdentityInvalidError("This identity has expired due this application's security policy. Please refresh your authentication.");
          }
          const sender = (id === null || id === void 0 ? void 0 : id.getPrincipal()) || Principal.anonymous();
          const transformedRequest = await this._transform({
            request: {
              method: "POST",
              headers: Object.assign({ "Content-Type": "application/cbor" }, __classPrivateFieldGet4(this, _HttpAgent_credentials, "f") ? { Authorization: "Basic " + btoa(__classPrivateFieldGet4(this, _HttpAgent_credentials, "f")) } : {})
            },
            endpoint: "read_state",
            body: {
              request_type: "read_state",
              paths: fields.paths,
              sender,
              ingress_expiry: new Expiry(__classPrivateFieldGet4(this, _HttpAgent_maxIngressExpiryInMinutes, "f") * MINUTE_TO_MSECS)
            }
          });
          return id === null || id === void 0 ? void 0 : id.transformRequest(transformedRequest);
        }
        async readState(canisterId, fields, identity, request2) {
          const canister = typeof canisterId === "string" ? Principal.fromText(canisterId) : canisterId;
          const transformedRequest = request2 !== null && request2 !== void 0 ? request2 : await this.createReadStateRequest(fields, identity);
          const bodyWithAdjustedExpiry = Object.assign(Object.assign({}, transformedRequest.body), { ingress_expiry: new Expiry(DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS) });
          const body = encode3(bodyWithAdjustedExpiry);
          this.log.print(`fetching "/api/v2/canister/${canister}/read_state" with request:`, transformedRequest);
          const backoff2 = __classPrivateFieldGet4(this, _HttpAgent_backoffStrategy, "f").call(this);
          try {
            const response = await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetry).call(this, {
              request: () => __classPrivateFieldGet4(this, _HttpAgent_fetch, "f").call(this, "" + new URL(`/api/v2/canister/${canister.toString()}/read_state`, this.host), Object.assign(Object.assign(Object.assign({}, __classPrivateFieldGet4(this, _HttpAgent_fetchOptions, "f")), transformedRequest.request), { body })),
              backoff: backoff2,
              tries: 0
            });
            if (!response.ok) {
              throw new Error(`Server returned an error:
  Code: ${response.status} (${response.statusText})
  Body: ${await response.text()}
`);
            }
            const decodedResponse = decode3(await response.arrayBuffer());
            this.log.print("Read state response:", decodedResponse);
            const parsedTime = await this.parseTimeFromResponse(decodedResponse);
            if (parsedTime > 0) {
              this.log.print("Read state response time:", parsedTime);
              __classPrivateFieldSet4(this, _HttpAgent_waterMark, parsedTime, "f");
            }
            return decodedResponse;
          } catch (error) {
            this.log.error("Caught exception while attempting to read state", error);
            throw error;
          }
        }
        async parseTimeFromResponse(response) {
          let tree;
          if (response.certificate) {
            const decoded = decode3(response.certificate);
            if (decoded && "tree" in decoded) {
              tree = decoded.tree;
            } else {
              throw new Error("Could not decode time from response");
            }
            const timeLookup = lookup_path(["time"], tree);
            if (timeLookup.status !== LookupStatus.Found) {
              throw new Error("Time was not found in the response or was not in its expected format.");
            }
            if (!(timeLookup.value instanceof ArrayBuffer) && !ArrayBuffer.isView(timeLookup)) {
              throw new Error("Time was not found in the response or was not in its expected format.");
            }
            const date = decodeTime(bufFromBufLike(timeLookup.value));
            this.log.print("Time from response:", date);
            this.log.print("Time from response in milliseconds:", Number(date));
            return Number(date);
          } else {
            this.log.warn("No certificate found in response");
          }
          return 0;
        }
        /**
         * Allows agent to sync its time with the network. Can be called during intialization or mid-lifecycle if the device's clock has drifted away from the network time. This is necessary to set the Expiry for a request
         * @param {Principal} canisterId - Pass a canister ID if you need to sync the time with a particular replica. Uses the management canister by default
         */
        async syncTime(canisterId) {
          const CanisterStatus = await Promise.resolve().then(() => (init_canisterStatus(), canisterStatus_exports));
          const callTime = Date.now();
          try {
            if (!canisterId) {
              this.log.print("Syncing time with the IC. No canisterId provided, so falling back to ryjl3-tyaaa-aaaaa-aaaba-cai");
            }
            const status = await CanisterStatus.request({
              // Fall back with canisterId of the ICP Ledger
              canisterId: canisterId !== null && canisterId !== void 0 ? canisterId : Principal.from("ryjl3-tyaaa-aaaaa-aaaba-cai"),
              agent: this,
              paths: ["time"]
            });
            const replicaTime = status.get("time");
            if (replicaTime) {
              __classPrivateFieldSet4(this, _HttpAgent_timeDiffMsecs, Number(replicaTime) - Number(callTime), "f");
            }
          } catch (error) {
            this.log.error("Caught exception while attempting to sync time", error);
          }
        }
        async status() {
          const headers = __classPrivateFieldGet4(this, _HttpAgent_credentials, "f") ? {
            Authorization: "Basic " + btoa(__classPrivateFieldGet4(this, _HttpAgent_credentials, "f"))
          } : {};
          this.log.print(`fetching "/api/v2/status"`);
          const backoff2 = __classPrivateFieldGet4(this, _HttpAgent_backoffStrategy, "f").call(this);
          const response = await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetry).call(this, {
            backoff: backoff2,
            request: () => __classPrivateFieldGet4(this, _HttpAgent_fetch, "f").call(this, "" + new URL(`/api/v2/status`, this.host), Object.assign({ headers }, __classPrivateFieldGet4(this, _HttpAgent_fetchOptions, "f"))),
            tries: 0
          });
          return decode3(await response.arrayBuffer());
        }
        async fetchRootKey() {
          if (!__classPrivateFieldGet4(this, _HttpAgent_rootKeyFetched, "f")) {
            const status = await this.status();
            this.rootKey = status.root_key;
            __classPrivateFieldSet4(this, _HttpAgent_rootKeyFetched, true, "f");
          }
          return this.rootKey;
        }
        invalidateIdentity() {
          __classPrivateFieldSet4(this, _HttpAgent_identity, null, "f");
        }
        replaceIdentity(identity) {
          __classPrivateFieldSet4(this, _HttpAgent_identity, Promise.resolve(identity), "f");
        }
        async fetchSubnetKeys(canisterId) {
          const effectiveCanisterId = Principal.from(canisterId);
          const response = await request({
            canisterId: effectiveCanisterId,
            paths: ["subnet"],
            agent: this
          });
          const subnetResponse = response.get("subnet");
          if (subnetResponse && typeof subnetResponse === "object" && "nodeKeys" in subnetResponse) {
            __classPrivateFieldGet4(this, _HttpAgent_subnetKeys, "f").set(effectiveCanisterId.toText(), subnetResponse);
            return subnetResponse;
          }
          return void 0;
        }
        _transform(request2) {
          let p3 = Promise.resolve(request2);
          if (request2.endpoint === "call") {
            for (const fn of __classPrivateFieldGet4(this, _HttpAgent_updatePipeline, "f")) {
              p3 = p3.then((r) => fn(r).then((r2) => r2 || r));
            }
          } else {
            for (const fn of __classPrivateFieldGet4(this, _HttpAgent_queryPipeline, "f")) {
              p3 = p3.then((r) => fn(r).then((r2) => r2 || r));
            }
          }
          return p3;
        }
      };
      _HttpAgent_identity = /* @__PURE__ */ new WeakMap(), _HttpAgent_fetch = /* @__PURE__ */ new WeakMap(), _HttpAgent_fetchOptions = /* @__PURE__ */ new WeakMap(), _HttpAgent_callOptions = /* @__PURE__ */ new WeakMap(), _HttpAgent_timeDiffMsecs = /* @__PURE__ */ new WeakMap(), _HttpAgent_credentials = /* @__PURE__ */ new WeakMap(), _HttpAgent_rootKeyFetched = /* @__PURE__ */ new WeakMap(), _HttpAgent_retryTimes = /* @__PURE__ */ new WeakMap(), _HttpAgent_backoffStrategy = /* @__PURE__ */ new WeakMap(), _HttpAgent_maxIngressExpiryInMinutes = /* @__PURE__ */ new WeakMap(), _HttpAgent_waterMark = /* @__PURE__ */ new WeakMap(), _HttpAgent_queryPipeline = /* @__PURE__ */ new WeakMap(), _HttpAgent_updatePipeline = /* @__PURE__ */ new WeakMap(), _HttpAgent_subnetKeys = /* @__PURE__ */ new WeakMap(), _HttpAgent_verifyQuerySignatures = /* @__PURE__ */ new WeakMap(), _HttpAgent_verifyQueryResponse = /* @__PURE__ */ new WeakMap(), _HttpAgent_instances = /* @__PURE__ */ new WeakSet(), _HttpAgent_requestAndRetryQuery = async function _HttpAgent_requestAndRetryQuery2(args) {
        var _a2, _b2;
        const { ecid, transformedRequest, body, requestId, backoff: backoff2, tries } = args;
        const delay = tries === 0 ? 0 : backoff2.next();
        this.log.print(`fetching "/api/v2/canister/${ecid.toString()}/query" with tries:`, {
          tries,
          backoff: backoff2,
          delay
        });
        if (delay === null) {
          throw new AgentError(`Timestamp failed to pass the watermark after retrying the configured ${__classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")} times. We cannot guarantee the integrity of the response since it could be a replay attack.`);
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        let response;
        try {
          this.log.print(`fetching "/api/v2/canister/${ecid.toString()}/query" with request:`, transformedRequest);
          const fetchResponse = await __classPrivateFieldGet4(this, _HttpAgent_fetch, "f").call(this, "" + new URL(`/api/v2/canister/${ecid.toString()}/query`, this.host), Object.assign(Object.assign(Object.assign({}, __classPrivateFieldGet4(this, _HttpAgent_fetchOptions, "f")), transformedRequest.request), { body }));
          if (fetchResponse.status === 200) {
            const queryResponse = decode3(await fetchResponse.arrayBuffer());
            response = Object.assign(Object.assign({}, queryResponse), { httpDetails: {
              ok: fetchResponse.ok,
              status: fetchResponse.status,
              statusText: fetchResponse.statusText,
              headers: httpHeadersTransform(fetchResponse.headers)
            }, requestId });
          } else {
            throw new AgentHTTPResponseError(`Gateway returned an error:
  Code: ${fetchResponse.status} (${fetchResponse.statusText})
  Body: ${await fetchResponse.text()}
`, {
              ok: fetchResponse.ok,
              status: fetchResponse.status,
              statusText: fetchResponse.statusText,
              headers: httpHeadersTransform(fetchResponse.headers)
            });
          }
        } catch (error) {
          if (tries < __classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")) {
            this.log.warn(`Caught exception while attempting to make query:
  ${error}
  Retrying query.`);
            return await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetryQuery2).call(this, Object.assign(Object.assign({}, args), { tries: tries + 1 }));
          }
          throw error;
        }
        const timestamp = (_b2 = (_a2 = response.signatures) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b2 === void 0 ? void 0 : _b2.timestamp;
        if (!__classPrivateFieldGet4(this, _HttpAgent_verifyQuerySignatures, "f")) {
          return response;
        }
        if (!timestamp) {
          throw new Error("Timestamp not found in query response. This suggests a malformed or malicious response.");
        }
        const timeStampInMs = Number(BigInt(timestamp) / BigInt(1e6));
        this.log.print("watermark and timestamp", {
          waterMark: this.waterMark,
          timestamp: timeStampInMs
        });
        if (Number(this.waterMark) > timeStampInMs) {
          const error = new AgentError("Timestamp is below the watermark. Retrying query.");
          this.log.error("Timestamp is below", error, {
            timestamp,
            waterMark: this.waterMark
          });
          if (tries < __classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")) {
            return await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetryQuery2).call(this, Object.assign(Object.assign({}, args), { tries: tries + 1 }));
          }
          {
            throw new AgentError(`Timestamp failed to pass the watermark after retrying the configured ${__classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")} times. We cannot guarantee the integrity of the response since it could be a replay attack.`);
          }
        }
        return response;
      }, _HttpAgent_requestAndRetry = async function _HttpAgent_requestAndRetry2(args) {
        const { request: request2, backoff: backoff2, tries } = args;
        const delay = tries === 0 ? 0 : backoff2.next();
        if (delay === null) {
          throw new AgentError(`Timestamp failed to pass the watermark after retrying the configured ${__classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")} times. We cannot guarantee the integrity of the response since it could be a replay attack.`);
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        let response;
        try {
          response = await request2();
        } catch (error) {
          if (__classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f") > tries) {
            this.log.warn(`Caught exception while attempting to make request:
  ${error}
  Retrying request.`);
            return await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetry2).call(this, { request: request2, backoff: backoff2, tries: tries + 1 });
          }
          throw error;
        }
        if (response.ok) {
          return response;
        }
        const responseText = await response.clone().text();
        const errorMessage = `Server returned an error:
  Code: ${response.status} (${response.statusText})
  Body: ${responseText}
`;
        if (response.status === 404 && response.url.includes("api/v3")) {
          throw new AgentHTTPResponseError("v3 api not supported. Fall back to v2", {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: httpHeadersTransform(response.headers)
          });
        }
        if (tries < __classPrivateFieldGet4(this, _HttpAgent_retryTimes, "f")) {
          return await __classPrivateFieldGet4(this, _HttpAgent_instances, "m", _HttpAgent_requestAndRetry2).call(this, { request: request2, backoff: backoff2, tries: tries + 1 });
        }
        throw new AgentHTTPResponseError(errorMessage, {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: httpHeadersTransform(response.headers)
        });
      };
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/proxy.js
  var ProxyMessageKind;
  var init_proxy = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/proxy.js"() {
      init_esm();
      (function(ProxyMessageKind2) {
        ProxyMessageKind2["Error"] = "err";
        ProxyMessageKind2["GetPrincipal"] = "gp";
        ProxyMessageKind2["GetPrincipalResponse"] = "gpr";
        ProxyMessageKind2["Query"] = "q";
        ProxyMessageKind2["QueryResponse"] = "qr";
        ProxyMessageKind2["Call"] = "c";
        ProxyMessageKind2["CallResponse"] = "cr";
        ProxyMessageKind2["ReadState"] = "rs";
        ProxyMessageKind2["ReadStateResponse"] = "rsr";
        ProxyMessageKind2["Status"] = "s";
        ProxyMessageKind2["StatusResponse"] = "sr";
      })(ProxyMessageKind || (ProxyMessageKind = {}));
    }
  });

  // node_modules/@dfinity/agent/lib/esm/agent/index.js
  function getDefaultAgent() {
    const agent = typeof window === "undefined" ? typeof window === "undefined" ? typeof self === "undefined" ? void 0 : self.ic.agent : window.ic.agent : window.ic.agent;
    if (!agent) {
      throw new Error("No Agent could be found.");
    }
    return agent;
  }
  var init_agent = __esm({
    "node_modules/@dfinity/agent/lib/esm/agent/index.js"() {
      init_api();
      init_http();
      init_errors2();
      init_proxy();
    }
  });

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    SnsGovernanceCanister: () => Qt,
    addControllerToNeuron: () => addControllerToNeuron
  });

  // node_modules/@dfinity/agent/lib/esm/actor.js
  var import_buffer14 = __toESM(require_buffer());
  init_agent();
  init_errors();
  init_esm2();

  // node_modules/@dfinity/agent/lib/esm/polling/index.js
  init_agent();
  init_certificate();
  init_buffer();

  // node_modules/@dfinity/agent/lib/esm/polling/strategy.js
  var strategy_exports = {};
  __export(strategy_exports, {
    backoff: () => backoff,
    chain: () => chain,
    conditionalDelay: () => conditionalDelay,
    defaultStrategy: () => defaultStrategy,
    maxAttempts: () => maxAttempts,
    once: () => once,
    throttle: () => throttle,
    timeout: () => timeout
  });
  init_buffer();
  var FIVE_MINUTES_IN_MSEC = 5 * 60 * 1e3;
  function defaultStrategy() {
    return chain(conditionalDelay(once(), 1e3), backoff(1e3, 1.2), timeout(FIVE_MINUTES_IN_MSEC));
  }
  function once() {
    let first = true;
    return async () => {
      if (first) {
        first = false;
        return true;
      }
      return false;
    };
  }
  function conditionalDelay(condition, timeInMsec) {
    return async (canisterId, requestId, status) => {
      if (await condition(canisterId, requestId, status)) {
        return new Promise((resolve) => setTimeout(resolve, timeInMsec));
      }
    };
  }
  function maxAttempts(count) {
    let attempts = count;
    return async (canisterId, requestId, status) => {
      if (--attempts <= 0) {
        throw new Error(`Failed to retrieve a reply for request after ${count} attempts:
  Request ID: ${toHex(requestId)}
  Request status: ${status}
`);
      }
    };
  }
  function throttle(throttleInMsec) {
    return () => new Promise((resolve) => setTimeout(resolve, throttleInMsec));
  }
  function timeout(timeInMsec) {
    const end = Date.now() + timeInMsec;
    return async (canisterId, requestId, status) => {
      if (Date.now() > end) {
        throw new Error(`Request timed out after ${timeInMsec} msec:
  Request ID: ${toHex(requestId)}
  Request status: ${status}
`);
      }
    };
  }
  function backoff(startingThrottleInMsec, backoffFactor) {
    let currentThrottling = startingThrottleInMsec;
    return () => new Promise((resolve) => setTimeout(() => {
      currentThrottling *= backoffFactor;
      resolve();
    }, currentThrottling));
  }
  function chain(...strategies) {
    return async (canisterId, requestId, status) => {
      for (const a of strategies) {
        await a(canisterId, requestId, status);
      }
    };
  }

  // node_modules/@dfinity/agent/lib/esm/polling/index.js
  init_constants();
  function hasProperty(value4, property) {
    return Object.prototype.hasOwnProperty.call(value4, property);
  }
  function isSignedReadStateRequestWithExpiry(value4) {
    return value4 !== null && typeof value4 === "object" && hasProperty(value4, "body") && value4.body !== null && typeof value4.body === "object" && hasProperty(value4.body, "content") && value4.body.content !== null && typeof value4.body.content === "object" && hasProperty(value4.body.content, "request_type") && value4.body.content.request_type === "read_state" && hasProperty(value4.body.content, "ingress_expiry") && typeof value4.body.content.ingress_expiry === "object" && value4.body.content.ingress_expiry !== null && hasProperty(value4.body.content.ingress_expiry, "toCBOR") && typeof value4.body.content.ingress_expiry.toCBOR === "function" && hasProperty(value4.body.content.ingress_expiry, "toHash") && typeof value4.body.content.ingress_expiry.toHash === "function";
  }
  async function pollForResponse(agent, canisterId, requestId, strategy = defaultStrategy(), request2, blsVerify2) {
    var _a2;
    const path = [new TextEncoder().encode("request_status"), requestId];
    const currentRequest = request2 !== null && request2 !== void 0 ? request2 : await ((_a2 = agent.createReadStateRequest) === null || _a2 === void 0 ? void 0 : _a2.call(agent, { paths: [path] }));
    if (request2 && isSignedReadStateRequestWithExpiry(currentRequest)) {
      currentRequest.body.content.ingress_expiry = new Expiry(DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS);
    }
    const state = await agent.readState(canisterId, { paths: [path] }, void 0, currentRequest);
    if (agent.rootKey == null)
      throw new Error("Agent root key not initialized before polling");
    const cert = await Certificate.create({
      certificate: state.certificate,
      rootKey: agent.rootKey,
      canisterId,
      blsVerify: blsVerify2
    });
    const maybeBuf = lookupResultToBuffer(cert.lookup([...path, new TextEncoder().encode("status")]));
    let status;
    if (typeof maybeBuf === "undefined") {
      status = RequestStatusResponseStatus.Unknown;
    } else {
      status = new TextDecoder().decode(maybeBuf);
    }
    switch (status) {
      case RequestStatusResponseStatus.Replied: {
        return {
          reply: lookupResultToBuffer(cert.lookup([...path, "reply"])),
          certificate: cert
        };
      }
      case RequestStatusResponseStatus.Received:
      case RequestStatusResponseStatus.Unknown:
      case RequestStatusResponseStatus.Processing:
        await strategy(canisterId, requestId, status);
        return pollForResponse(agent, canisterId, requestId, strategy, currentRequest, blsVerify2);
      case RequestStatusResponseStatus.Rejected: {
        const rejectCode = new Uint8Array(lookupResultToBuffer(cert.lookup([...path, "reject_code"])))[0];
        const rejectMessage = new TextDecoder().decode(lookupResultToBuffer(cert.lookup([...path, "reject_message"])));
        throw new Error(`Call was rejected:
  Request ID: ${toHex(requestId)}
  Reject code: ${rejectCode}
  Reject text: ${rejectMessage}
`);
      }
      case RequestStatusResponseStatus.Done:
        throw new Error(`Call was marked as done but we never saw the reply:
  Request ID: ${toHex(requestId)}
`);
    }
    throw new Error("unreachable");
  }

  // node_modules/@dfinity/agent/lib/esm/actor.js
  init_esm();
  init_buffer();
  init_certificate();

  // node_modules/@dfinity/agent/lib/esm/canisters/management_idl.js
  var management_idl_default = ({ IDL }) => {
    const bitcoin_network = IDL.Variant({
      mainnet: IDL.Null,
      testnet: IDL.Null
    });
    const bitcoin_address = IDL.Text;
    const bitcoin_get_balance_args = IDL.Record({
      network: bitcoin_network,
      address: bitcoin_address,
      min_confirmations: IDL.Opt(IDL.Nat32)
    });
    const satoshi = IDL.Nat64;
    const bitcoin_get_balance_result = satoshi;
    const bitcoin_block_height = IDL.Nat32;
    const bitcoin_get_block_headers_args = IDL.Record({
      start_height: bitcoin_block_height,
      end_height: IDL.Opt(bitcoin_block_height),
      network: bitcoin_network
    });
    const bitcoin_block_header = IDL.Vec(IDL.Nat8);
    const bitcoin_get_block_headers_result = IDL.Record({
      tip_height: bitcoin_block_height,
      block_headers: IDL.Vec(bitcoin_block_header)
    });
    const bitcoin_get_current_fee_percentiles_args = IDL.Record({
      network: bitcoin_network
    });
    const millisatoshi_per_byte = IDL.Nat64;
    const bitcoin_get_current_fee_percentiles_result = IDL.Vec(millisatoshi_per_byte);
    const bitcoin_get_utxos_args = IDL.Record({
      network: bitcoin_network,
      filter: IDL.Opt(IDL.Variant({
        page: IDL.Vec(IDL.Nat8),
        min_confirmations: IDL.Nat32
      })),
      address: bitcoin_address
    });
    const bitcoin_block_hash = IDL.Vec(IDL.Nat8);
    const outpoint = IDL.Record({
      txid: IDL.Vec(IDL.Nat8),
      vout: IDL.Nat32
    });
    const utxo = IDL.Record({
      height: IDL.Nat32,
      value: satoshi,
      outpoint
    });
    const bitcoin_get_utxos_result = IDL.Record({
      next_page: IDL.Opt(IDL.Vec(IDL.Nat8)),
      tip_height: bitcoin_block_height,
      tip_block_hash: bitcoin_block_hash,
      utxos: IDL.Vec(utxo)
    });
    const bitcoin_send_transaction_args = IDL.Record({
      transaction: IDL.Vec(IDL.Nat8),
      network: bitcoin_network
    });
    const canister_id = IDL.Principal;
    const canister_info_args = IDL.Record({
      canister_id,
      num_requested_changes: IDL.Opt(IDL.Nat64)
    });
    const change_origin = IDL.Variant({
      from_user: IDL.Record({ user_id: IDL.Principal }),
      from_canister: IDL.Record({
        canister_version: IDL.Opt(IDL.Nat64),
        canister_id: IDL.Principal
      })
    });
    const snapshot_id = IDL.Vec(IDL.Nat8);
    const change_details = IDL.Variant({
      creation: IDL.Record({ controllers: IDL.Vec(IDL.Principal) }),
      code_deployment: IDL.Record({
        mode: IDL.Variant({
          reinstall: IDL.Null,
          upgrade: IDL.Null,
          install: IDL.Null
        }),
        module_hash: IDL.Vec(IDL.Nat8)
      }),
      load_snapshot: IDL.Record({
        canister_version: IDL.Nat64,
        taken_at_timestamp: IDL.Nat64,
        snapshot_id
      }),
      controllers_change: IDL.Record({
        controllers: IDL.Vec(IDL.Principal)
      }),
      code_uninstall: IDL.Null
    });
    const change = IDL.Record({
      timestamp_nanos: IDL.Nat64,
      canister_version: IDL.Nat64,
      origin: change_origin,
      details: change_details
    });
    const canister_info_result = IDL.Record({
      controllers: IDL.Vec(IDL.Principal),
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
      recent_changes: IDL.Vec(change),
      total_num_changes: IDL.Nat64
    });
    const canister_status_args = IDL.Record({ canister_id });
    const log_visibility = IDL.Variant({
      controllers: IDL.Null,
      public: IDL.Null
    });
    const definite_canister_settings = IDL.Record({
      freezing_threshold: IDL.Nat,
      controllers: IDL.Vec(IDL.Principal),
      reserved_cycles_limit: IDL.Nat,
      log_visibility,
      wasm_memory_limit: IDL.Nat,
      memory_allocation: IDL.Nat,
      compute_allocation: IDL.Nat
    });
    const canister_status_result = IDL.Record({
      status: IDL.Variant({
        stopped: IDL.Null,
        stopping: IDL.Null,
        running: IDL.Null
      }),
      memory_size: IDL.Nat,
      cycles: IDL.Nat,
      settings: definite_canister_settings,
      query_stats: IDL.Record({
        response_payload_bytes_total: IDL.Nat,
        num_instructions_total: IDL.Nat,
        num_calls_total: IDL.Nat,
        request_payload_bytes_total: IDL.Nat
      }),
      idle_cycles_burned_per_day: IDL.Nat,
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
      reserved_cycles: IDL.Nat
    });
    const clear_chunk_store_args = IDL.Record({ canister_id });
    const canister_settings = IDL.Record({
      freezing_threshold: IDL.Opt(IDL.Nat),
      controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
      reserved_cycles_limit: IDL.Opt(IDL.Nat),
      log_visibility: IDL.Opt(log_visibility),
      wasm_memory_limit: IDL.Opt(IDL.Nat),
      memory_allocation: IDL.Opt(IDL.Nat),
      compute_allocation: IDL.Opt(IDL.Nat)
    });
    const create_canister_args = IDL.Record({
      settings: IDL.Opt(canister_settings),
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const create_canister_result = IDL.Record({ canister_id });
    const delete_canister_args = IDL.Record({ canister_id });
    const delete_canister_snapshot_args = IDL.Record({
      canister_id,
      snapshot_id
    });
    const deposit_cycles_args = IDL.Record({ canister_id });
    const ecdsa_curve = IDL.Variant({ secp256k1: IDL.Null });
    const ecdsa_public_key_args = IDL.Record({
      key_id: IDL.Record({ name: IDL.Text, curve: ecdsa_curve }),
      canister_id: IDL.Opt(canister_id),
      derivation_path: IDL.Vec(IDL.Vec(IDL.Nat8))
    });
    const ecdsa_public_key_result = IDL.Record({
      public_key: IDL.Vec(IDL.Nat8),
      chain_code: IDL.Vec(IDL.Nat8)
    });
    const fetch_canister_logs_args = IDL.Record({ canister_id });
    const canister_log_record = IDL.Record({
      idx: IDL.Nat64,
      timestamp_nanos: IDL.Nat64,
      content: IDL.Vec(IDL.Nat8)
    });
    const fetch_canister_logs_result = IDL.Record({
      canister_log_records: IDL.Vec(canister_log_record)
    });
    const http_header = IDL.Record({ value: IDL.Text, name: IDL.Text });
    const http_request_result = IDL.Record({
      status: IDL.Nat,
      body: IDL.Vec(IDL.Nat8),
      headers: IDL.Vec(http_header)
    });
    const http_request_args = IDL.Record({
      url: IDL.Text,
      method: IDL.Variant({
        get: IDL.Null,
        head: IDL.Null,
        post: IDL.Null
      }),
      max_response_bytes: IDL.Opt(IDL.Nat64),
      body: IDL.Opt(IDL.Vec(IDL.Nat8)),
      transform: IDL.Opt(IDL.Record({
        function: IDL.Func([
          IDL.Record({
            context: IDL.Vec(IDL.Nat8),
            response: http_request_result
          })
        ], [http_request_result], ["query"]),
        context: IDL.Vec(IDL.Nat8)
      })),
      headers: IDL.Vec(http_header)
    });
    const canister_install_mode = IDL.Variant({
      reinstall: IDL.Null,
      upgrade: IDL.Opt(IDL.Record({
        wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })),
        skip_pre_upgrade: IDL.Opt(IDL.Bool)
      })),
      install: IDL.Null
    });
    const chunk_hash = IDL.Record({ hash: IDL.Vec(IDL.Nat8) });
    const install_chunked_code_args = IDL.Record({
      arg: IDL.Vec(IDL.Nat8),
      wasm_module_hash: IDL.Vec(IDL.Nat8),
      mode: canister_install_mode,
      chunk_hashes_list: IDL.Vec(chunk_hash),
      target_canister: canister_id,
      store_canister: IDL.Opt(canister_id),
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const wasm_module = IDL.Vec(IDL.Nat8);
    const install_code_args = IDL.Record({
      arg: IDL.Vec(IDL.Nat8),
      wasm_module,
      mode: canister_install_mode,
      canister_id,
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const list_canister_snapshots_args = IDL.Record({
      canister_id
    });
    const snapshot = IDL.Record({
      id: snapshot_id,
      total_size: IDL.Nat64,
      taken_at_timestamp: IDL.Nat64
    });
    const list_canister_snapshots_result = IDL.Vec(snapshot);
    const load_canister_snapshot_args = IDL.Record({
      canister_id,
      sender_canister_version: IDL.Opt(IDL.Nat64),
      snapshot_id
    });
    const node_metrics_history_args = IDL.Record({
      start_at_timestamp_nanos: IDL.Nat64,
      subnet_id: IDL.Principal
    });
    const node_metrics = IDL.Record({
      num_block_failures_total: IDL.Nat64,
      node_id: IDL.Principal,
      num_blocks_proposed_total: IDL.Nat64
    });
    const node_metrics_history_result = IDL.Vec(IDL.Record({
      timestamp_nanos: IDL.Nat64,
      node_metrics: IDL.Vec(node_metrics)
    }));
    const provisional_create_canister_with_cycles_args = IDL.Record({
      settings: IDL.Opt(canister_settings),
      specified_id: IDL.Opt(canister_id),
      amount: IDL.Opt(IDL.Nat),
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const provisional_create_canister_with_cycles_result = IDL.Record({
      canister_id
    });
    const provisional_top_up_canister_args = IDL.Record({
      canister_id,
      amount: IDL.Nat
    });
    const raw_rand_result = IDL.Vec(IDL.Nat8);
    const schnorr_algorithm = IDL.Variant({
      ed25519: IDL.Null,
      bip340secp256k1: IDL.Null
    });
    const schnorr_public_key_args = IDL.Record({
      key_id: IDL.Record({
        algorithm: schnorr_algorithm,
        name: IDL.Text
      }),
      canister_id: IDL.Opt(canister_id),
      derivation_path: IDL.Vec(IDL.Vec(IDL.Nat8))
    });
    const schnorr_public_key_result = IDL.Record({
      public_key: IDL.Vec(IDL.Nat8),
      chain_code: IDL.Vec(IDL.Nat8)
    });
    const sign_with_ecdsa_args = IDL.Record({
      key_id: IDL.Record({ name: IDL.Text, curve: ecdsa_curve }),
      derivation_path: IDL.Vec(IDL.Vec(IDL.Nat8)),
      message_hash: IDL.Vec(IDL.Nat8)
    });
    const sign_with_ecdsa_result = IDL.Record({
      signature: IDL.Vec(IDL.Nat8)
    });
    const sign_with_schnorr_args = IDL.Record({
      key_id: IDL.Record({
        algorithm: schnorr_algorithm,
        name: IDL.Text
      }),
      derivation_path: IDL.Vec(IDL.Vec(IDL.Nat8)),
      message: IDL.Vec(IDL.Nat8)
    });
    const sign_with_schnorr_result = IDL.Record({
      signature: IDL.Vec(IDL.Nat8)
    });
    const start_canister_args = IDL.Record({ canister_id });
    const stop_canister_args = IDL.Record({ canister_id });
    const stored_chunks_args = IDL.Record({ canister_id });
    const stored_chunks_result = IDL.Vec(chunk_hash);
    const take_canister_snapshot_args = IDL.Record({
      replace_snapshot: IDL.Opt(snapshot_id),
      canister_id
    });
    const take_canister_snapshot_result = snapshot;
    const uninstall_code_args = IDL.Record({
      canister_id,
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const update_settings_args = IDL.Record({
      canister_id: IDL.Principal,
      settings: canister_settings,
      sender_canister_version: IDL.Opt(IDL.Nat64)
    });
    const upload_chunk_args = IDL.Record({
      chunk: IDL.Vec(IDL.Nat8),
      canister_id: IDL.Principal
    });
    const upload_chunk_result = chunk_hash;
    return IDL.Service({
      bitcoin_get_balance: IDL.Func([bitcoin_get_balance_args], [bitcoin_get_balance_result], []),
      bitcoin_get_block_headers: IDL.Func([bitcoin_get_block_headers_args], [bitcoin_get_block_headers_result], []),
      bitcoin_get_current_fee_percentiles: IDL.Func([bitcoin_get_current_fee_percentiles_args], [bitcoin_get_current_fee_percentiles_result], []),
      bitcoin_get_utxos: IDL.Func([bitcoin_get_utxos_args], [bitcoin_get_utxos_result], []),
      bitcoin_send_transaction: IDL.Func([bitcoin_send_transaction_args], [], []),
      canister_info: IDL.Func([canister_info_args], [canister_info_result], []),
      canister_status: IDL.Func([canister_status_args], [canister_status_result], []),
      clear_chunk_store: IDL.Func([clear_chunk_store_args], [], []),
      create_canister: IDL.Func([create_canister_args], [create_canister_result], []),
      delete_canister: IDL.Func([delete_canister_args], [], []),
      delete_canister_snapshot: IDL.Func([delete_canister_snapshot_args], [], []),
      deposit_cycles: IDL.Func([deposit_cycles_args], [], []),
      ecdsa_public_key: IDL.Func([ecdsa_public_key_args], [ecdsa_public_key_result], []),
      fetch_canister_logs: IDL.Func([fetch_canister_logs_args], [fetch_canister_logs_result], ["query"]),
      http_request: IDL.Func([http_request_args], [http_request_result], []),
      install_chunked_code: IDL.Func([install_chunked_code_args], [], []),
      install_code: IDL.Func([install_code_args], [], []),
      list_canister_snapshots: IDL.Func([list_canister_snapshots_args], [list_canister_snapshots_result], []),
      load_canister_snapshot: IDL.Func([load_canister_snapshot_args], [], []),
      node_metrics_history: IDL.Func([node_metrics_history_args], [node_metrics_history_result], []),
      provisional_create_canister_with_cycles: IDL.Func([provisional_create_canister_with_cycles_args], [provisional_create_canister_with_cycles_result], []),
      provisional_top_up_canister: IDL.Func([provisional_top_up_canister_args], [], []),
      raw_rand: IDL.Func([], [raw_rand_result], []),
      schnorr_public_key: IDL.Func([schnorr_public_key_args], [schnorr_public_key_result], []),
      sign_with_ecdsa: IDL.Func([sign_with_ecdsa_args], [sign_with_ecdsa_result], []),
      sign_with_schnorr: IDL.Func([sign_with_schnorr_args], [sign_with_schnorr_result], []),
      start_canister: IDL.Func([start_canister_args], [], []),
      stop_canister: IDL.Func([stop_canister_args], [], []),
      stored_chunks: IDL.Func([stored_chunks_args], [stored_chunks_result], []),
      take_canister_snapshot: IDL.Func([take_canister_snapshot_args], [take_canister_snapshot_result], []),
      uninstall_code: IDL.Func([uninstall_code_args], [], []),
      update_settings: IDL.Func([update_settings_args], [], []),
      upload_chunk: IDL.Func([upload_chunk_args], [upload_chunk_result], [])
    });
  };

  // node_modules/@dfinity/agent/lib/esm/actor.js
  var ActorCallError = class extends AgentError {
    constructor(canisterId, methodName, type, props) {
      super([
        `Call failed:`,
        `  Canister: ${canisterId.toText()}`,
        `  Method: ${methodName} (${type})`,
        ...Object.getOwnPropertyNames(props).map((n2) => `  "${n2}": ${JSON.stringify(props[n2])}`)
      ].join("\n"));
      this.canisterId = canisterId;
      this.methodName = methodName;
      this.type = type;
      this.props = props;
    }
  };
  var QueryCallRejectedError = class extends ActorCallError {
    constructor(canisterId, methodName, result) {
      var _a2;
      super(canisterId, methodName, "query", {
        Status: result.status,
        Code: (_a2 = ReplicaRejectCode[result.reject_code]) !== null && _a2 !== void 0 ? _a2 : `Unknown Code "${result.reject_code}"`,
        Message: result.reject_message
      });
      this.result = result;
    }
  };
  var UpdateCallRejectedError = class extends ActorCallError {
    constructor(canisterId, methodName, requestId, response, reject_code, reject_message, error_code) {
      super(canisterId, methodName, "update", Object.assign({ "Request ID": toHex(requestId) }, response.body ? Object.assign(Object.assign({}, error_code ? {
        "Error code": error_code
      } : {}), { "Reject code": String(reject_code), "Reject message": reject_message }) : {
        "HTTP status code": response.status.toString(),
        "HTTP status text": response.statusText
      }));
      this.requestId = requestId;
      this.response = response;
      this.reject_code = reject_code;
      this.reject_message = reject_message;
      this.error_code = error_code;
    }
  };
  var metadataSymbol = Symbol.for("ic-agent-metadata");
  var Actor = class _Actor {
    constructor(metadata) {
      this[metadataSymbol] = Object.freeze(metadata);
    }
    /**
     * Get the Agent class this Actor would call, or undefined if the Actor would use
     * the default agent (global.ic.agent).
     * @param actor The actor to get the agent of.
     */
    static agentOf(actor) {
      return actor[metadataSymbol].config.agent;
    }
    /**
     * Get the interface of an actor, in the form of an instance of a Service.
     * @param actor The actor to get the interface of.
     */
    static interfaceOf(actor) {
      return actor[metadataSymbol].service;
    }
    static canisterIdOf(actor) {
      return Principal.from(actor[metadataSymbol].config.canisterId);
    }
    static async install(fields, config) {
      const mode = fields.mode === void 0 ? { install: null } : fields.mode;
      const arg = fields.arg ? [...new Uint8Array(fields.arg)] : [];
      const wasmModule = [...new Uint8Array(fields.module)];
      const canisterId = typeof config.canisterId === "string" ? Principal.fromText(config.canisterId) : config.canisterId;
      await getManagementCanister(config).install_code({
        mode,
        arg,
        wasm_module: wasmModule,
        canister_id: canisterId,
        sender_canister_version: []
      });
    }
    static async createCanister(config, settings) {
      function settingsToCanisterSettings(settings2) {
        return [
          {
            controllers: settings2.controllers ? [settings2.controllers] : [],
            compute_allocation: settings2.compute_allocation ? [settings2.compute_allocation] : [],
            freezing_threshold: settings2.freezing_threshold ? [settings2.freezing_threshold] : [],
            memory_allocation: settings2.memory_allocation ? [settings2.memory_allocation] : [],
            reserved_cycles_limit: [],
            log_visibility: [],
            wasm_memory_limit: []
          }
        ];
      }
      const { canister_id: canisterId } = await getManagementCanister(config || {}).provisional_create_canister_with_cycles({
        amount: [],
        settings: settingsToCanisterSettings(settings || {}),
        specified_id: [],
        sender_canister_version: []
      });
      return canisterId;
    }
    static async createAndInstallCanister(interfaceFactory, fields, config) {
      const canisterId = await this.createCanister(config);
      await this.install(Object.assign({}, fields), Object.assign(Object.assign({}, config), { canisterId }));
      return this.createActor(interfaceFactory, Object.assign(Object.assign({}, config), { canisterId }));
    }
    static createActorClass(interfaceFactory, options) {
      const service = interfaceFactory({ IDL: idl_exports });
      class CanisterActor extends _Actor {
        constructor(config) {
          if (!config.canisterId)
            throw new AgentError(`Canister ID is required, but received ${typeof config.canisterId} instead. If you are using automatically generated declarations, this may be because your application is not setting the canister ID in process.env correctly.`);
          const canisterId = typeof config.canisterId === "string" ? Principal.fromText(config.canisterId) : config.canisterId;
          super({
            config: Object.assign(Object.assign(Object.assign({}, DEFAULT_ACTOR_CONFIG), config), { canisterId }),
            service
          });
          for (const [methodName, func] of service._fields) {
            if (options === null || options === void 0 ? void 0 : options.httpDetails) {
              func.annotations.push(ACTOR_METHOD_WITH_HTTP_DETAILS);
            }
            if (options === null || options === void 0 ? void 0 : options.certificate) {
              func.annotations.push(ACTOR_METHOD_WITH_CERTIFICATE);
            }
            this[methodName] = _createActorMethod(this, methodName, func, config.blsVerify);
          }
        }
      }
      return CanisterActor;
    }
    static createActor(interfaceFactory, configuration) {
      if (!configuration.canisterId) {
        throw new AgentError(`Canister ID is required, but received ${typeof configuration.canisterId} instead. If you are using automatically generated declarations, this may be because your application is not setting the canister ID in process.env correctly.`);
      }
      return new (this.createActorClass(interfaceFactory))(configuration);
    }
    /**
     * Returns an actor with methods that return the http response details along with the result
     * @param interfaceFactory - the interface factory for the actor
     * @param configuration - the configuration for the actor
     * @deprecated - use createActor with actorClassOptions instead
     */
    static createActorWithHttpDetails(interfaceFactory, configuration) {
      return new (this.createActorClass(interfaceFactory, { httpDetails: true }))(configuration);
    }
    /**
     * Returns an actor with methods that return the http response details along with the result
     * @param interfaceFactory - the interface factory for the actor
     * @param configuration - the configuration for the actor
     * @param actorClassOptions - options for the actor class extended details to return with the result
     */
    static createActorWithExtendedDetails(interfaceFactory, configuration, actorClassOptions = {
      httpDetails: true,
      certificate: true
    }) {
      return new (this.createActorClass(interfaceFactory, actorClassOptions))(configuration);
    }
  };
  function decodeReturnValue(types, msg) {
    const returnValues = idl_exports.decode(types, import_buffer14.Buffer.from(msg));
    switch (returnValues.length) {
      case 0:
        return void 0;
      case 1:
        return returnValues[0];
      default:
        return returnValues;
    }
  }
  var DEFAULT_ACTOR_CONFIG = {
    pollingStrategyFactory: strategy_exports.defaultStrategy
  };
  var ACTOR_METHOD_WITH_HTTP_DETAILS = "http-details";
  var ACTOR_METHOD_WITH_CERTIFICATE = "certificate";
  function _createActorMethod(actor, methodName, func, blsVerify2) {
    let caller;
    if (func.annotations.includes("query") || func.annotations.includes("composite_query")) {
      caller = async (options, ...args) => {
        var _a2, _b2;
        options = Object.assign(Object.assign({}, options), (_b2 = (_a2 = actor[metadataSymbol].config).queryTransform) === null || _b2 === void 0 ? void 0 : _b2.call(_a2, methodName, args, Object.assign(Object.assign({}, actor[metadataSymbol].config), options)));
        const agent = options.agent || actor[metadataSymbol].config.agent || getDefaultAgent();
        const cid = Principal.from(options.canisterId || actor[metadataSymbol].config.canisterId);
        const arg = idl_exports.encode(func.argTypes, args);
        const result = await agent.query(cid, {
          methodName,
          arg,
          effectiveCanisterId: options.effectiveCanisterId
        });
        const httpDetails = Object.assign(Object.assign({}, result.httpDetails), { requestDetails: result.requestDetails });
        switch (result.status) {
          case "rejected":
            throw new QueryCallRejectedError(cid, methodName, result);
          case "replied":
            return func.annotations.includes(ACTOR_METHOD_WITH_HTTP_DETAILS) ? {
              httpDetails,
              result: decodeReturnValue(func.retTypes, result.reply.arg)
            } : decodeReturnValue(func.retTypes, result.reply.arg);
        }
      };
    } else {
      caller = async (options, ...args) => {
        var _a2, _b2;
        options = Object.assign(Object.assign({}, options), (_b2 = (_a2 = actor[metadataSymbol].config).callTransform) === null || _b2 === void 0 ? void 0 : _b2.call(_a2, methodName, args, Object.assign(Object.assign({}, actor[metadataSymbol].config), options)));
        const agent = options.agent || actor[metadataSymbol].config.agent || getDefaultAgent();
        const { canisterId, effectiveCanisterId, pollingStrategyFactory } = Object.assign(Object.assign(Object.assign({}, DEFAULT_ACTOR_CONFIG), actor[metadataSymbol].config), options);
        const cid = Principal.from(canisterId);
        const ecid = effectiveCanisterId !== void 0 ? Principal.from(effectiveCanisterId) : cid;
        const arg = idl_exports.encode(func.argTypes, args);
        if (agent.rootKey == null)
          throw new AgentError("Agent root key not initialized before making call");
        const { requestId, response, requestDetails } = await agent.call(cid, {
          methodName,
          arg,
          effectiveCanisterId: ecid
        });
        let reply;
        let certificate;
        if (response.body && response.body.certificate) {
          const cert = response.body.certificate;
          certificate = await Certificate.create({
            certificate: bufFromBufLike2(cert),
            rootKey: agent.rootKey,
            canisterId: Principal.from(canisterId),
            blsVerify: blsVerify2
          });
          const path = [new TextEncoder().encode("request_status"), requestId];
          const status = new TextDecoder().decode(lookupResultToBuffer(certificate.lookup([...path, "status"])));
          switch (status) {
            case "replied":
              reply = lookupResultToBuffer(certificate.lookup([...path, "reply"]));
              break;
            case "rejected": {
              const rejectCode = new Uint8Array(lookupResultToBuffer(certificate.lookup([...path, "reject_code"])))[0];
              const rejectMessage = new TextDecoder().decode(lookupResultToBuffer(certificate.lookup([...path, "reject_message"])));
              const error_code_buf = lookupResultToBuffer(certificate.lookup([...path, "error_code"]));
              const error_code = error_code_buf ? new TextDecoder().decode(error_code_buf) : void 0;
              throw new UpdateCallRejectedError(cid, methodName, requestId, response, rejectCode, rejectMessage, error_code);
            }
          }
        } else if (response.body && "reject_message" in response.body) {
          const { reject_code, reject_message, error_code } = response.body;
          throw new UpdateCallRejectedError(cid, methodName, requestId, response, reject_code, reject_message, error_code);
        }
        if (response.status === 202) {
          const pollStrategy = pollingStrategyFactory();
          const response2 = await pollForResponse(agent, ecid, requestId, pollStrategy, blsVerify2);
          certificate = response2.certificate;
          reply = response2.reply;
        }
        const shouldIncludeHttpDetails = func.annotations.includes(ACTOR_METHOD_WITH_HTTP_DETAILS);
        const shouldIncludeCertificate = func.annotations.includes(ACTOR_METHOD_WITH_CERTIFICATE);
        const httpDetails = Object.assign(Object.assign({}, response), { requestDetails });
        if (reply !== void 0) {
          if (shouldIncludeHttpDetails && shouldIncludeCertificate) {
            return {
              httpDetails,
              certificate,
              result: decodeReturnValue(func.retTypes, reply)
            };
          } else if (shouldIncludeCertificate) {
            return {
              certificate,
              result: decodeReturnValue(func.retTypes, reply)
            };
          } else if (shouldIncludeHttpDetails) {
            return {
              httpDetails,
              result: decodeReturnValue(func.retTypes, reply)
            };
          }
          return decodeReturnValue(func.retTypes, reply);
        } else if (func.retTypes.length === 0) {
          return shouldIncludeHttpDetails ? {
            httpDetails: response,
            result: void 0
          } : void 0;
        } else {
          throw new Error(`Call was returned undefined, but type [${func.retTypes.join(",")}].`);
        }
      };
    }
    const handler = (...args) => caller({}, ...args);
    handler.withOptions = (options) => (...args) => caller(options, ...args);
    return handler;
  }
  function getManagementCanister(config) {
    function transform(methodName, args) {
      if (config.effectiveCanisterId) {
        return { effectiveCanisterId: Principal.from(config.effectiveCanisterId) };
      }
      const first = args[0];
      let effectiveCanisterId = Principal.fromHex("");
      if (first && typeof first === "object" && first.target_canister && methodName === "install_chunked_code") {
        effectiveCanisterId = Principal.from(first.target_canister);
      }
      if (first && typeof first === "object" && first.canister_id) {
        effectiveCanisterId = Principal.from(first.canister_id);
      }
      return { effectiveCanisterId };
    }
    return Actor.createActor(management_idl_default, Object.assign(Object.assign(Object.assign({}, config), { canisterId: Principal.fromHex("") }), {
      callTransform: transform,
      queryTransform: transform
    }));
  }

  // node_modules/@dfinity/agent/lib/esm/index.js
  init_agent();
  init_transforms();
  init_types2();
  init_auth();
  init_certificate();
  init_der();

  // node_modules/@dfinity/agent/lib/esm/fetch_candid.js
  init_esm();
  init_canisterStatus();
  init_http();

  // node_modules/@dfinity/agent/lib/esm/index.js
  init_public_key();
  init_request_id();
  init_bls2();
  init_buffer();
  init_random();
  init_canisterStatus();
  init_cbor();

  // node_modules/@dfinity/sns/dist/esm/chunk-4INNMFYU.js
  var t = class extends Error {
  };

  // node_modules/@dfinity/utils/dist/esm/index.js
  init_esm();
  var h = ((n2) => (n2[n2.FractionalMoreThan8Decimals = 0] = "FractionalMoreThan8Decimals", n2[n2.InvalidFormat = 1] = "InvalidFormat", n2[n2.FractionalTooManyDecimals = 2] = "FractionalTooManyDecimals", n2))(h || {});
  var T = BigInt(1e8);
  var U = class {
    constructor(t2, r, n2) {
      this.id = t2;
      this.service = r;
      this.certifiedService = n2;
      this.caller = ({ certified: t3 = true }) => t3 ? this.certifiedService : this.service;
    }
    get canisterId() {
      return this.id;
    }
  };
  var b = (e3) => e3 == null;
  var c = (e3) => !b(e3);
  var w = () => HttpAgent.createSync({ host: "https://icp-api.io", identity: new AnonymousIdentity() });
  var at = ({ options: { canisterId: e3, serviceOverride: t2, certifiedServiceOverride: r, agent: n2, callTransform: i, queryTransform: o }, idlFactory: s2, certifiedIdlFactory: a }) => {
    let l = n2 ?? w(), R2 = t2 ?? Actor.createActor(s2, { agent: l, canisterId: e3, callTransform: i, queryTransform: o }), D2 = r ?? Actor.createActor(a, { agent: l, canisterId: e3, callTransform: i, queryTransform: o });
    return { service: R2, certifiedService: D2, agent: l, canisterId: e3 };
  };
  var p = class extends Error {
  };
  var m = class extends Error {
  };
  var x = (e3, t2) => {
    if (e3 == null)
      throw new m(t2);
  };
  var xt = (e3) => {
    if (e3 < 0 || e3 > 100)
      throw new p(`${e3} is not a valid percentage number.`);
  };
  var At = (e3) => {
    let t2 = e3.match(/.{1,2}/g);
    return x(t2, "Invalid hex string."), Uint8Array.from(t2.map((r) => parseInt(r, 16)));
  };
  var u = "abcdefghijklmnopqrstuvwxyz234567";
  var d = /* @__PURE__ */ Object.create(null);
  for (let e3 = 0; e3 < u.length; e3++)
    d[u[e3]] = e3;
  d[0] = d.o;
  d[1] = d.i;
  var Y = new Uint32Array([0, 1996959894, 3993919788, 2567524794, 124634137, 1886057615, 3915621685, 2657392035, 249268274, 2044508324, 3772115230, 2547177864, 162941995, 2125561021, 3887607047, 2428444049, 498536548, 1789927666, 4089016648, 2227061214, 450548861, 1843258603, 4107580753, 2211677639, 325883990, 1684777152, 4251122042, 2321926636, 335633487, 1661365465, 4195302755, 2366115317, 997073096, 1281953886, 3579855332, 2724688242, 1006888145, 1258607687, 3524101629, 2768942443, 901097722, 1119000684, 3686517206, 2898065728, 853044451, 1172266101, 3705015759, 2882616665, 651767980, 1373503546, 3369554304, 3218104598, 565507253, 1454621731, 3485111705, 3099436303, 671266974, 1594198024, 3322730930, 2970347812, 795835527, 1483230225, 3244367275, 3060149565, 1994146192, 31158534, 2563907772, 4023717930, 1907459465, 112637215, 2680153253, 3904427059, 2013776290, 251722036, 2517215374, 3775830040, 2137656763, 141376813, 2439277719, 3865271297, 1802195444, 476864866, 2238001368, 4066508878, 1812370925, 453092731, 2181625025, 4111451223, 1706088902, 314042704, 2344532202, 4240017532, 1658658271, 366619977, 2362670323, 4224994405, 1303535960, 984961486, 2747007092, 3569037538, 1256170817, 1037604311, 2765210733, 3554079995, 1131014506, 879679996, 2909243462, 3663771856, 1141124467, 855842277, 2852801631, 3708648649, 1342533948, 654459306, 3188396048, 3373015174, 1466479909, 544179635, 3110523913, 3462522015, 1591671054, 702138776, 2966460450, 3352799412, 1504918807, 783551873, 3082640443, 3233442989, 3988292384, 2596254646, 62317068, 1957810842, 3939845945, 2647816111, 81470997, 1943803523, 3814918930, 2489596804, 225274430, 2053790376, 3826175755, 2466906013, 167816743, 2097651377, 4027552580, 2265490386, 503444072, 1762050814, 4150417245, 2154129355, 426522225, 1852507879, 4275313526, 2312317920, 282753626, 1742555852, 4189708143, 2394877945, 397917763, 1622183637, 3604390888, 2714866558, 953729732, 1340076626, 3518719985, 2797360999, 1068828381, 1219638859, 3624741850, 2936675148, 906185462, 1090812512, 3747672003, 2825379669, 829329135, 1181335161, 3412177804, 3160834842, 628085408, 1382605366, 3423369109, 3138078467, 570562233, 1426400815, 3317316542, 2998733608, 733239954, 1555261956, 3268935591, 3050360625, 752459403, 1541320221, 2607071920, 3965973030, 1969922972, 40735498, 2617837225, 3943577151, 1913087877, 83908371, 2512341634, 3803740692, 2075208622, 213261112, 2463272603, 3855990285, 2094854071, 198958881, 2262029012, 4057260610, 1759359992, 534414190, 2176718541, 4139329115, 1873836001, 414664567, 2282248934, 4279200368, 1711684554, 285281116, 2405801727, 4167216745, 1634467795, 376229701, 2685067896, 3608007406, 1308918612, 956543938, 2808555105, 3495958263, 1231636301, 1047427035, 2932959818, 3654703836, 1088359270, 936918e3, 2847714899, 3736837829, 1202900863, 817233897, 3183342108, 3401237130, 1404277552, 615818150, 3134207493, 3453421203, 1423857449, 601450431, 3009837614, 3294710456, 1567103746, 711928724, 3020668471, 3272380065, 1510334235, 755167117]);
  var Mt = (e3) => c(e3) ? [e3] : [];
  var j = (e3) => e3?.[0];

  // node_modules/@dfinity/sns/dist/esm/chunk-DHX6PNLG.js
  var Tt = ({ IDL: e3 }) => {
    let o = e3.Record({ last_spawned_timestamp_seconds: e3.Opt(e3.Nat64), last_reset_timestamp_seconds: e3.Opt(e3.Nat64), requires_periodic_tasks: e3.Opt(e3.Bool) }), t2 = e3.Record({ archive_wasm_hash: e3.Vec(e3.Nat8), root_wasm_hash: e3.Vec(e3.Nat8), swap_wasm_hash: e3.Vec(e3.Nat8), ledger_wasm_hash: e3.Vec(e3.Nat8), governance_wasm_hash: e3.Vec(e3.Nat8), index_wasm_hash: e3.Vec(e3.Nat8) }), s2 = e3.Record({ versions: e3.Vec(t2) }), i = e3.Record({ upgrade_steps: e3.Opt(s2), response_timestamp_seconds: e3.Opt(e3.Nat64), requested_timestamp_seconds: e3.Opt(e3.Nat64) }), a = e3.Record({ validator_canister_id: e3.Opt(e3.Principal), target_canister_id: e3.Opt(e3.Principal), validator_method_name: e3.Opt(e3.Text), target_method_name: e3.Opt(e3.Text) }), d2 = e3.Variant({ NativeNervousSystemFunction: e3.Record({}), GenericNervousSystemFunction: a }), c3 = e3.Record({ id: e3.Nat64, name: e3.Text, description: e3.Opt(e3.Text), function_type: e3.Opt(d2) }), l = e3.Record({ not_dissolving_neurons_e8s_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Float64)), garbage_collectable_neurons_count: e3.Nat64, neurons_with_invalid_stake_count: e3.Nat64, not_dissolving_neurons_count_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Nat64)), neurons_with_less_than_6_months_dissolve_delay_count: e3.Nat64, dissolved_neurons_count: e3.Nat64, total_staked_e8s: e3.Nat64, total_supply_governance_tokens: e3.Nat64, not_dissolving_neurons_count: e3.Nat64, dissolved_neurons_e8s: e3.Nat64, neurons_with_less_than_6_months_dissolve_delay_e8s: e3.Nat64, dissolving_neurons_count_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Nat64)), dissolving_neurons_count: e3.Nat64, dissolving_neurons_e8s_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Float64)), timestamp_seconds: e3.Nat64 }), w3 = e3.Record({ current_basis_points: e3.Opt(e3.Int32), updated_at_timestamp_seconds: e3.Opt(e3.Nat64) }), X = e3.Record({ old_target_version: e3.Opt(t2), new_target_version: e3.Opt(t2) }), H = e3.Record({ human_readable: e3.Opt(e3.Text), upgrade_steps: e3.Opt(s2) }), K = e3.Record({ status: e3.Opt(e3.Variant({ Success: e3.Record({}), Timeout: e3.Record({}), ExternalFailure: e3.Record({}), InvalidState: e3.Record({ version: e3.Opt(t2) }) })), human_readable: e3.Opt(e3.Text) }), _2 = e3.Record({ id: e3.Nat64 }), Y2 = e3.Record({ current_version: e3.Opt(t2), expected_version: e3.Opt(t2), reason: e3.Opt(e3.Variant({ UpgradeSnsToNextVersionProposal: _2, BehindTargetVersion: e3.Record({}) })) }), Z = e3.Record({ upgrade_steps: e3.Opt(s2) }), D2 = e3.Record({ human_readable: e3.Opt(e3.Text), old_target_version: e3.Opt(t2), new_target_version: e3.Opt(t2) }), I2 = e3.Record({ event: e3.Opt(e3.Variant({ TargetVersionSet: X, UpgradeStepsReset: H, UpgradeOutcome: K, UpgradeStarted: Y2, UpgradeStepsRefreshed: Z, TargetVersionReset: D2 })), timestamp_seconds: e3.Opt(e3.Nat64) }), T3 = e3.Record({ entries: e3.Vec(I2) }), r = e3.Record({ id: e3.Vec(e3.Nat8) }), P2 = e3.Record({ followees: e3.Vec(r) }), L3 = e3.Record({ followees: e3.Vec(e3.Tuple(e3.Nat64, P2)) }), m3 = e3.Record({ permissions: e3.Vec(e3.Int32) }), ee = e3.Record({ final_reward_rate_basis_points: e3.Opt(e3.Nat64), initial_reward_rate_basis_points: e3.Opt(e3.Nat64), reward_rate_transition_duration_seconds: e3.Opt(e3.Nat64), round_duration_seconds: e3.Opt(e3.Nat64) }), O = e3.Record({ default_followees: e3.Opt(L3), max_dissolve_delay_seconds: e3.Opt(e3.Nat64), max_dissolve_delay_bonus_percentage: e3.Opt(e3.Nat64), max_followees_per_function: e3.Opt(e3.Nat64), neuron_claimer_permissions: e3.Opt(m3), neuron_minimum_stake_e8s: e3.Opt(e3.Nat64), max_neuron_age_for_age_bonus: e3.Opt(e3.Nat64), initial_voting_period_seconds: e3.Opt(e3.Nat64), neuron_minimum_dissolve_delay_to_vote_seconds: e3.Opt(e3.Nat64), reject_cost_e8s: e3.Opt(e3.Nat64), max_proposals_to_keep_per_action: e3.Opt(e3.Nat32), wait_for_quiet_deadline_increase_seconds: e3.Opt(e3.Nat64), max_number_of_neurons: e3.Opt(e3.Nat64), transaction_fee_e8s: e3.Opt(e3.Nat64), max_number_of_proposals_with_ballots: e3.Opt(e3.Nat64), max_age_bonus_percentage: e3.Opt(e3.Nat64), neuron_grantable_permissions: e3.Opt(m3), voting_rewards_parameters: e3.Opt(ee), maturity_modulation_disabled: e3.Opt(e3.Bool), max_number_of_principals_per_neuron: e3.Opt(e3.Nat64) }), h3 = e3.Record({ rounds_since_last_distribution: e3.Opt(e3.Nat64), actual_timestamp_seconds: e3.Nat64, end_timestamp_seconds: e3.Opt(e3.Nat64), total_available_e8s_equivalent: e3.Opt(e3.Nat64), distributed_e8s_equivalent: e3.Nat64, round: e3.Nat64, settled_proposals: e3.Vec(_2) }), te = e3.Record({ mark_failed_at_seconds: e3.Nat64, checking_upgrade_lock: e3.Nat64, proposal_id: e3.Opt(e3.Nat64), target_version: e3.Opt(t2) }), N2 = e3.Record({ error_message: e3.Text, error_type: e3.Int32 }), g3 = e3.Record({ subaccount: e3.Vec(e3.Nat8) }), p3 = e3.Record({ owner: e3.Opt(e3.Principal), subaccount: e3.Opt(g3) }), b3 = e3.Record({ human_readable: e3.Opt(e3.Text) }), se2 = e3.Record({ e8s: e3.Opt(e3.Nat64) }), oe2 = e3.Record({ xdrs_per_icp: e3.Opt(b3), icps_per_token: e3.Opt(b3), tokens: e3.Opt(se2) }), ne2 = e3.Record({ token: e3.Opt(e3.Int32), account: e3.Opt(p3), valuation_factors: e3.Opt(oe2), timestamp_seconds: e3.Opt(e3.Nat64) }), M = e3.Record({ valuation: e3.Opt(ne2) }), x5 = e3.Record({ archive_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), root_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), swap_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), ledger_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), governance_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), index_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)) }), ae = e3.Record({ target_version: e3.Opt(x5) }), re = e3.Variant({ TransferSnsTreasuryFunds: M, MintSnsTokens: M, AdvanceSnsTargetVersion: ae }), ie2 = e3.Record({ vote: e3.Int32, cast_timestamp_seconds: e3.Nat64, voting_power: e3.Nat64 }), F = e3.Record({ basis_points: e3.Opt(e3.Nat64) }), ce = e3.Record({ no: e3.Nat64, yes: e3.Nat64, total: e3.Nat64, timestamp_seconds: e3.Nat64 }), _e = e3.Record({ freezing_threshold: e3.Opt(e3.Nat64), canister_ids: e3.Vec(e3.Principal), reserved_cycles_limit: e3.Opt(e3.Nat64), log_visibility: e3.Opt(e3.Int32), wasm_memory_limit: e3.Opt(e3.Nat64), memory_allocation: e3.Opt(e3.Nat64), compute_allocation: e3.Opt(e3.Nat64) }), de2 = e3.Record({ canister_ids: e3.Vec(e3.Principal) }), pe2 = e3.Record({ from_treasury: e3.Int32, to_principal: e3.Opt(e3.Principal), to_subaccount: e3.Opt(g3), memo: e3.Opt(e3.Nat64), amount_e8s: e3.Nat64 }), ue2 = e3.Record({ new_canister_wasm: e3.Vec(e3.Nat8), mode: e3.Opt(e3.Int32), canister_id: e3.Opt(e3.Principal), canister_upgrade_arg: e3.Opt(e3.Vec(e3.Nat8)) }), le = e3.Record({ canister_ids: e3.Vec(e3.Principal), new_controllers: e3.Vec(e3.Principal) }), me2 = e3.Record({ to_principal: e3.Opt(e3.Principal), to_subaccount: e3.Opt(g3), memo: e3.Opt(e3.Nat64), amount_e8s: e3.Opt(e3.Nat64) }), Ne = e3.Record({ new_target: e3.Opt(x5) }), C2 = e3.Record({ url: e3.Opt(e3.Text), logo: e3.Opt(e3.Text), name: e3.Opt(e3.Text), description: e3.Opt(e3.Text) }), Oe = e3.Record({ function_id: e3.Nat64, payload: e3.Vec(e3.Nat8) }), ge2 = e3.Record({ token_symbol: e3.Opt(e3.Text), transfer_fee: e3.Opt(e3.Nat64), token_logo: e3.Opt(e3.Text), token_name: e3.Opt(e3.Text) }), Re = e3.Record({ motion_text: e3.Text }), ve = e3.Variant({ ManageNervousSystemParameters: O, AddGenericNervousSystemFunction: c3, ManageDappCanisterSettings: _e, RemoveGenericNervousSystemFunction: e3.Nat64, UpgradeSnsToNextVersion: e3.Record({}), RegisterDappCanisters: de2, TransferSnsTreasuryFunds: pe2, UpgradeSnsControlledCanister: ue2, DeregisterDappCanisters: le, MintSnsTokens: me2, AdvanceSnsTargetVersion: Ne, Unspecified: e3.Record({}), ManageSnsMetadata: C2, ExecuteGenericNervousSystemFunction: Oe, ManageLedgerParameters: ge2, Motion: Re }), R2 = e3.Record({ url: e3.Text, title: e3.Text, action: e3.Opt(ve), summary: e3.Text }), ye = e3.Record({ current_deadline_timestamp_seconds: e3.Nat64 }), v2 = e3.Record({ id: e3.Opt(_2), payload_text_rendering: e3.Opt(e3.Text), action: e3.Nat64, failure_reason: e3.Opt(N2), action_auxiliary: e3.Opt(re), ballots: e3.Vec(e3.Tuple(e3.Text, ie2)), minimum_yes_proportion_of_total: e3.Opt(F), reward_event_round: e3.Nat64, failed_timestamp_seconds: e3.Nat64, reward_event_end_timestamp_seconds: e3.Opt(e3.Nat64), proposal_creation_timestamp_seconds: e3.Nat64, initial_voting_period_seconds: e3.Nat64, reject_cost_e8s: e3.Nat64, latest_tally: e3.Opt(ce), wait_for_quiet_deadline_increase_seconds: e3.Nat64, decided_timestamp_seconds: e3.Nat64, proposal: e3.Opt(R2), proposer: e3.Opt(r), wait_for_quiet_state: e3.Opt(ye), minimum_yes_proportion_of_exercised: e3.Opt(F), is_eligible_for_rewards: e3.Bool, executed_timestamp_seconds: e3.Nat64 }), k2 = e3.Record({ memo: e3.Nat64, amount_e8s: e3.Nat64 }), A2 = e3.Record({ function_id: e3.Nat64, followees: e3.Vec(r) }), q = e3.Record({ to_account: e3.Opt(p3), percentage_to_disburse: e3.Nat32 }), Se = e3.Record({ requested_setting_for_auto_stake_maturity: e3.Bool }), fe2 = e3.Record({ additional_dissolve_delay_seconds: e3.Nat32 }), Ve = e3.Record({ dissolve_timestamp_seconds: e3.Nat64 }), we = e3.Variant({ ChangeAutoStakeMaturity: Se, StopDissolving: e3.Record({}), StartDissolving: e3.Record({}), IncreaseDissolveDelay: fe2, SetDissolveTimestamp: Ve }), G2 = e3.Record({ operation: e3.Opt(we) }), U3 = e3.Record({ vote: e3.Int32, proposal: e3.Opt(_2) }), Te = e3.Record({ amount_to_be_disbursed_e8s: e3.Nat64, to_account: e3.Opt(p3) }), Pe = e3.Record({ controller: e3.Opt(e3.Principal), memo: e3.Nat64 }), he = e3.Variant({ MemoAndController: Pe, NeuronId: e3.Record({}) }), E2 = e3.Record({ by: e3.Opt(he) }), B2 = e3.Record({ permissions_to_remove: e3.Opt(m3), principal_id: e3.Opt(e3.Principal) }), z = e3.Record({ permissions_to_add: e3.Opt(m3), principal_id: e3.Opt(e3.Principal) }), j2 = e3.Record({ percentage_to_merge: e3.Nat32 }), be = e3.Record({ e8s: e3.Nat64 }), J = e3.Record({ to_account: e3.Opt(p3), amount: e3.Opt(be) }), Me = e3.Variant({ Split: k2, Follow: A2, DisburseMaturity: q, Configure: G2, RegisterVote: U3, SyncCommand: e3.Record({}), MakeProposal: R2, FinalizeDisburseMaturity: Te, ClaimOrRefreshNeuron: E2, RemoveNeuronPermissions: B2, AddNeuronPermissions: z, MergeMaturity: j2, Disburse: J }), xe = e3.Record({ command: e3.Opt(Me), timestamp: e3.Nat64 }), Fe = e3.Record({ principal: e3.Opt(e3.Principal), permission_type: e3.Vec(e3.Int32) }), Ce = e3.Variant({ DissolveDelaySeconds: e3.Nat64, WhenDissolvedTimestampSeconds: e3.Nat64 }), ke = e3.Record({ timestamp_of_disbursement_seconds: e3.Nat64, amount_e8s: e3.Nat64, account_to_disburse_to: e3.Opt(p3), finalize_disbursement_timestamp_seconds: e3.Opt(e3.Nat64) }), y = e3.Record({ id: e3.Opt(r), staked_maturity_e8s_equivalent: e3.Opt(e3.Nat64), permissions: e3.Vec(Fe), maturity_e8s_equivalent: e3.Nat64, cached_neuron_stake_e8s: e3.Nat64, created_timestamp_seconds: e3.Nat64, source_nns_neuron_id: e3.Opt(e3.Nat64), auto_stake_maturity: e3.Opt(e3.Bool), aging_since_timestamp_seconds: e3.Nat64, dissolve_state: e3.Opt(Ce), voting_power_percentage_multiplier: e3.Nat64, vesting_period_seconds: e3.Opt(e3.Nat64), disburse_maturity_in_progress: e3.Vec(ke), followees: e3.Vec(e3.Tuple(e3.Nat64, P2)), neuron_fees_e8s: e3.Nat64 }), Wt = e3.Record({ root_canister_id: e3.Opt(e3.Principal), timers: e3.Opt(o), cached_upgrade_steps: e3.Opt(i), id_to_nervous_system_functions: e3.Vec(e3.Tuple(e3.Nat64, c3)), metrics: e3.Opt(l), maturity_modulation: e3.Opt(w3), upgrade_journal: e3.Opt(T3), mode: e3.Int32, parameters: e3.Opt(O), is_finalizing_disburse_maturity: e3.Opt(e3.Bool), deployed_version: e3.Opt(t2), sns_initialization_parameters: e3.Text, latest_reward_event: e3.Opt(h3), pending_version: e3.Opt(te), swap_canister_id: e3.Opt(e3.Principal), ledger_canister_id: e3.Opt(e3.Principal), proposals: e3.Vec(e3.Tuple(e3.Nat64, v2)), in_flight_commands: e3.Vec(e3.Tuple(e3.Text, xe)), sns_metadata: e3.Opt(C2), neurons: e3.Vec(e3.Tuple(e3.Text, y)), target_version: e3.Opt(t2), genesis_timestamp_seconds: e3.Nat64 }), Ae = e3.Record({ principals: e3.Vec(e3.Principal) }), qe = e3.Record({ nns_neuron_hotkeys: e3.Opt(Ae), nns_neuron_controller: e3.Opt(e3.Principal), nns_neuron_id: e3.Opt(e3.Nat64) }), Ge = e3.Variant({ NeuronsFund: qe, Direct: e3.Record({}) }), Ue = e3.Record({ neuron_ids: e3.Vec(r) }), Ee = e3.Record({ controller: e3.Opt(e3.Principal), dissolve_delay_seconds: e3.Opt(e3.Nat64), participant: e3.Opt(Ge), stake_e8s: e3.Opt(e3.Nat64), followees: e3.Opt(Ue), neuron_id: e3.Opt(r) }), Be = e3.Record({ neuron_recipes: e3.Vec(Ee) }), ze = e3.Record({ neuron_recipes: e3.Opt(Be) }), je = e3.Record({ id: e3.Opt(r), status: e3.Int32 }), Je = e3.Record({ swap_neurons: e3.Vec(je) }), Qe = e3.Variant({ Ok: Je, Err: e3.Int32 }), We = e3.Record({ claim_swap_neurons_result: e3.Opt(Qe) }), $e = e3.Record({ maturity_modulation: e3.Opt(w3) }), Xe = e3.Record({ url: e3.Opt(e3.Text), logo: e3.Opt(e3.Text), name: e3.Opt(e3.Text), description: e3.Opt(e3.Text) }), He = e3.Record({ mode: e3.Opt(e3.Int32) }), Ke = e3.Record({ neuron_id: e3.Opt(r) }), Ye = e3.Variant({ Error: N2, Neuron: y }), Ze = e3.Record({ result: e3.Opt(Ye) }), Q = e3.Record({ proposal_id: e3.Opt(_2) }), De = e3.Variant({ Error: N2, Proposal: v2 }), Ie = e3.Record({ result: e3.Opt(De) }), Le = e3.Variant({ stopped: e3.Null, stopping: e3.Null, running: e3.Null }), et = e3.Record({ freezing_threshold: e3.Nat, controllers: e3.Vec(e3.Principal), wasm_memory_limit: e3.Opt(e3.Nat), memory_allocation: e3.Nat, compute_allocation: e3.Nat }), tt = e3.Record({ status: Le, memory_size: e3.Nat, cycles: e3.Nat, settings: et, idle_cycles_burned_per_day: e3.Nat, module_hash: e3.Opt(e3.Vec(e3.Nat8)) }), st = e3.Record({ deployed_version: e3.Opt(t2), pending_version: e3.Opt(e3.Record({ mark_failed_at_seconds: e3.Nat64, checking_upgrade_lock: e3.Nat64, proposal_id: e3.Nat64, target_version: e3.Opt(t2) })) }), ot = e3.Record({ sns_initialization_parameters: e3.Text }), nt = e3.Record({ timers: e3.Opt(o) }), at2 = e3.Record({ offset: e3.Opt(e3.Nat64), limit: e3.Opt(e3.Nat64) }), rt = e3.Record({ upgrade_journal: e3.Opt(T3), upgrade_steps: e3.Opt(s2), response_timestamp_seconds: e3.Opt(e3.Nat64), deployed_version: e3.Opt(t2), target_version: e3.Opt(t2), upgrade_journal_entry_count: e3.Opt(e3.Nat64) }), it = e3.Record({ reserved_ids: e3.Vec(e3.Nat64), functions: e3.Vec(c3) }), ct = e3.Record({ of_principal: e3.Opt(e3.Principal), limit: e3.Nat32, start_page_at: e3.Opt(r) }), _t = e3.Record({ neurons: e3.Vec(y) }), dt = e3.Record({ include_reward_status: e3.Vec(e3.Int32), before_proposal: e3.Opt(_2), limit: e3.Nat32, exclude_type: e3.Vec(e3.Nat64), include_status: e3.Vec(e3.Int32) }), pt = e3.Record({ include_ballots_by_caller: e3.Opt(e3.Bool), proposals: e3.Vec(v2) }), ut2 = e3.Record({ percentage_to_stake: e3.Opt(e3.Nat32) }), lt2 = e3.Variant({ Split: k2, Follow: A2, DisburseMaturity: q, ClaimOrRefresh: E2, Configure: G2, RegisterVote: U3, MakeProposal: R2, StakeMaturity: ut2, RemoveNeuronPermissions: B2, AddNeuronPermissions: z, MergeMaturity: j2, Disburse: J }), mt = e3.Record({ subaccount: e3.Vec(e3.Nat8), command: e3.Opt(lt2) }), Nt = e3.Record({ created_neuron_id: e3.Opt(r) }), Ot = e3.Record({ amount_disbursed_e8s: e3.Nat64, amount_deducted_e8s: e3.Opt(e3.Nat64) }), gt2 = e3.Record({ refreshed_neuron_id: e3.Opt(r) }), Rt = e3.Record({ maturity_e8s: e3.Nat64, staked_maturity_e8s: e3.Nat64 }), vt = e3.Record({ merged_maturity_e8s: e3.Nat64, new_stake_e8s: e3.Nat64 }), yt2 = e3.Record({ transfer_block_height: e3.Nat64 }), St = e3.Variant({ Error: N2, Split: Nt, Follow: e3.Record({}), DisburseMaturity: Ot, ClaimOrRefresh: gt2, Configure: e3.Record({}), RegisterVote: e3.Record({}), MakeProposal: Q, RemoveNeuronPermission: e3.Record({}), StakeMaturity: Rt, MergeMaturity: vt, Disburse: yt2, AddNeuronPermission: e3.Record({}) }), ft = e3.Record({ command: e3.Opt(St) }), Vt = e3.Record({ mode: e3.Int32 });
    return e3.Service({ claim_swap_neurons: e3.Func([ze], [We], []), fail_stuck_upgrade_in_progress: e3.Func([e3.Record({})], [e3.Record({})], []), get_build_metadata: e3.Func([], [e3.Text], []), get_latest_reward_event: e3.Func([], [h3], []), get_maturity_modulation: e3.Func([e3.Record({})], [$e], []), get_metadata: e3.Func([e3.Record({})], [Xe], []), get_mode: e3.Func([e3.Record({})], [He], []), get_nervous_system_parameters: e3.Func([e3.Null], [O], []), get_neuron: e3.Func([Ke], [Ze], []), get_proposal: e3.Func([Q], [Ie], []), get_root_canister_status: e3.Func([e3.Null], [tt], []), get_running_sns_version: e3.Func([e3.Record({})], [st], []), get_sns_initialization_parameters: e3.Func([e3.Record({})], [ot], []), get_timers: e3.Func([e3.Record({})], [nt], []), get_upgrade_journal: e3.Func([at2], [rt], []), list_nervous_system_functions: e3.Func([], [it], []), list_neurons: e3.Func([ct], [_t], []), list_proposals: e3.Func([dt], [pt], []), manage_neuron: e3.Func([mt], [ft], []), reset_timers: e3.Func([e3.Record({})], [e3.Record({})], []), set_mode: e3.Func([Vt], [e3.Record({})], []) });
  };
  var Pt = ({ IDL: e3 }) => {
    let o = e3.Record({ last_spawned_timestamp_seconds: e3.Opt(e3.Nat64), last_reset_timestamp_seconds: e3.Opt(e3.Nat64), requires_periodic_tasks: e3.Opt(e3.Bool) }), t2 = e3.Record({ archive_wasm_hash: e3.Vec(e3.Nat8), root_wasm_hash: e3.Vec(e3.Nat8), swap_wasm_hash: e3.Vec(e3.Nat8), ledger_wasm_hash: e3.Vec(e3.Nat8), governance_wasm_hash: e3.Vec(e3.Nat8), index_wasm_hash: e3.Vec(e3.Nat8) }), s2 = e3.Record({ versions: e3.Vec(t2) }), i = e3.Record({ upgrade_steps: e3.Opt(s2), response_timestamp_seconds: e3.Opt(e3.Nat64), requested_timestamp_seconds: e3.Opt(e3.Nat64) }), a = e3.Record({ validator_canister_id: e3.Opt(e3.Principal), target_canister_id: e3.Opt(e3.Principal), validator_method_name: e3.Opt(e3.Text), target_method_name: e3.Opt(e3.Text) }), d2 = e3.Variant({ NativeNervousSystemFunction: e3.Record({}), GenericNervousSystemFunction: a }), c3 = e3.Record({ id: e3.Nat64, name: e3.Text, description: e3.Opt(e3.Text), function_type: e3.Opt(d2) }), l = e3.Record({ not_dissolving_neurons_e8s_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Float64)), garbage_collectable_neurons_count: e3.Nat64, neurons_with_invalid_stake_count: e3.Nat64, not_dissolving_neurons_count_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Nat64)), neurons_with_less_than_6_months_dissolve_delay_count: e3.Nat64, dissolved_neurons_count: e3.Nat64, total_staked_e8s: e3.Nat64, total_supply_governance_tokens: e3.Nat64, not_dissolving_neurons_count: e3.Nat64, dissolved_neurons_e8s: e3.Nat64, neurons_with_less_than_6_months_dissolve_delay_e8s: e3.Nat64, dissolving_neurons_count_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Nat64)), dissolving_neurons_count: e3.Nat64, dissolving_neurons_e8s_buckets: e3.Vec(e3.Tuple(e3.Nat64, e3.Float64)), timestamp_seconds: e3.Nat64 }), w3 = e3.Record({ current_basis_points: e3.Opt(e3.Int32), updated_at_timestamp_seconds: e3.Opt(e3.Nat64) }), X = e3.Record({ old_target_version: e3.Opt(t2), new_target_version: e3.Opt(t2) }), H = e3.Record({ human_readable: e3.Opt(e3.Text), upgrade_steps: e3.Opt(s2) }), K = e3.Record({ status: e3.Opt(e3.Variant({ Success: e3.Record({}), Timeout: e3.Record({}), ExternalFailure: e3.Record({}), InvalidState: e3.Record({ version: e3.Opt(t2) }) })), human_readable: e3.Opt(e3.Text) }), _2 = e3.Record({ id: e3.Nat64 }), Y2 = e3.Record({ current_version: e3.Opt(t2), expected_version: e3.Opt(t2), reason: e3.Opt(e3.Variant({ UpgradeSnsToNextVersionProposal: _2, BehindTargetVersion: e3.Record({}) })) }), Z = e3.Record({ upgrade_steps: e3.Opt(s2) }), D2 = e3.Record({ human_readable: e3.Opt(e3.Text), old_target_version: e3.Opt(t2), new_target_version: e3.Opt(t2) }), I2 = e3.Record({ event: e3.Opt(e3.Variant({ TargetVersionSet: X, UpgradeStepsReset: H, UpgradeOutcome: K, UpgradeStarted: Y2, UpgradeStepsRefreshed: Z, TargetVersionReset: D2 })), timestamp_seconds: e3.Opt(e3.Nat64) }), T3 = e3.Record({ entries: e3.Vec(I2) }), r = e3.Record({ id: e3.Vec(e3.Nat8) }), P2 = e3.Record({ followees: e3.Vec(r) }), L3 = e3.Record({ followees: e3.Vec(e3.Tuple(e3.Nat64, P2)) }), m3 = e3.Record({ permissions: e3.Vec(e3.Int32) }), ee = e3.Record({ final_reward_rate_basis_points: e3.Opt(e3.Nat64), initial_reward_rate_basis_points: e3.Opt(e3.Nat64), reward_rate_transition_duration_seconds: e3.Opt(e3.Nat64), round_duration_seconds: e3.Opt(e3.Nat64) }), O = e3.Record({ default_followees: e3.Opt(L3), max_dissolve_delay_seconds: e3.Opt(e3.Nat64), max_dissolve_delay_bonus_percentage: e3.Opt(e3.Nat64), max_followees_per_function: e3.Opt(e3.Nat64), neuron_claimer_permissions: e3.Opt(m3), neuron_minimum_stake_e8s: e3.Opt(e3.Nat64), max_neuron_age_for_age_bonus: e3.Opt(e3.Nat64), initial_voting_period_seconds: e3.Opt(e3.Nat64), neuron_minimum_dissolve_delay_to_vote_seconds: e3.Opt(e3.Nat64), reject_cost_e8s: e3.Opt(e3.Nat64), max_proposals_to_keep_per_action: e3.Opt(e3.Nat32), wait_for_quiet_deadline_increase_seconds: e3.Opt(e3.Nat64), max_number_of_neurons: e3.Opt(e3.Nat64), transaction_fee_e8s: e3.Opt(e3.Nat64), max_number_of_proposals_with_ballots: e3.Opt(e3.Nat64), max_age_bonus_percentage: e3.Opt(e3.Nat64), neuron_grantable_permissions: e3.Opt(m3), voting_rewards_parameters: e3.Opt(ee), maturity_modulation_disabled: e3.Opt(e3.Bool), max_number_of_principals_per_neuron: e3.Opt(e3.Nat64) }), h3 = e3.Record({ rounds_since_last_distribution: e3.Opt(e3.Nat64), actual_timestamp_seconds: e3.Nat64, end_timestamp_seconds: e3.Opt(e3.Nat64), total_available_e8s_equivalent: e3.Opt(e3.Nat64), distributed_e8s_equivalent: e3.Nat64, round: e3.Nat64, settled_proposals: e3.Vec(_2) }), te = e3.Record({ mark_failed_at_seconds: e3.Nat64, checking_upgrade_lock: e3.Nat64, proposal_id: e3.Opt(e3.Nat64), target_version: e3.Opt(t2) }), N2 = e3.Record({ error_message: e3.Text, error_type: e3.Int32 }), g3 = e3.Record({ subaccount: e3.Vec(e3.Nat8) }), p3 = e3.Record({ owner: e3.Opt(e3.Principal), subaccount: e3.Opt(g3) }), b3 = e3.Record({ human_readable: e3.Opt(e3.Text) }), se2 = e3.Record({ e8s: e3.Opt(e3.Nat64) }), oe2 = e3.Record({ xdrs_per_icp: e3.Opt(b3), icps_per_token: e3.Opt(b3), tokens: e3.Opt(se2) }), ne2 = e3.Record({ token: e3.Opt(e3.Int32), account: e3.Opt(p3), valuation_factors: e3.Opt(oe2), timestamp_seconds: e3.Opt(e3.Nat64) }), M = e3.Record({ valuation: e3.Opt(ne2) }), x5 = e3.Record({ archive_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), root_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), swap_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), ledger_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), governance_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)), index_wasm_hash: e3.Opt(e3.Vec(e3.Nat8)) }), ae = e3.Record({ target_version: e3.Opt(x5) }), re = e3.Variant({ TransferSnsTreasuryFunds: M, MintSnsTokens: M, AdvanceSnsTargetVersion: ae }), ie2 = e3.Record({ vote: e3.Int32, cast_timestamp_seconds: e3.Nat64, voting_power: e3.Nat64 }), F = e3.Record({ basis_points: e3.Opt(e3.Nat64) }), ce = e3.Record({ no: e3.Nat64, yes: e3.Nat64, total: e3.Nat64, timestamp_seconds: e3.Nat64 }), _e = e3.Record({ freezing_threshold: e3.Opt(e3.Nat64), canister_ids: e3.Vec(e3.Principal), reserved_cycles_limit: e3.Opt(e3.Nat64), log_visibility: e3.Opt(e3.Int32), wasm_memory_limit: e3.Opt(e3.Nat64), memory_allocation: e3.Opt(e3.Nat64), compute_allocation: e3.Opt(e3.Nat64) }), de2 = e3.Record({ canister_ids: e3.Vec(e3.Principal) }), pe2 = e3.Record({ from_treasury: e3.Int32, to_principal: e3.Opt(e3.Principal), to_subaccount: e3.Opt(g3), memo: e3.Opt(e3.Nat64), amount_e8s: e3.Nat64 }), ue2 = e3.Record({ new_canister_wasm: e3.Vec(e3.Nat8), mode: e3.Opt(e3.Int32), canister_id: e3.Opt(e3.Principal), canister_upgrade_arg: e3.Opt(e3.Vec(e3.Nat8)) }), le = e3.Record({ canister_ids: e3.Vec(e3.Principal), new_controllers: e3.Vec(e3.Principal) }), me2 = e3.Record({ to_principal: e3.Opt(e3.Principal), to_subaccount: e3.Opt(g3), memo: e3.Opt(e3.Nat64), amount_e8s: e3.Opt(e3.Nat64) }), Ne = e3.Record({ new_target: e3.Opt(x5) }), C2 = e3.Record({ url: e3.Opt(e3.Text), logo: e3.Opt(e3.Text), name: e3.Opt(e3.Text), description: e3.Opt(e3.Text) }), Oe = e3.Record({ function_id: e3.Nat64, payload: e3.Vec(e3.Nat8) }), ge2 = e3.Record({ token_symbol: e3.Opt(e3.Text), transfer_fee: e3.Opt(e3.Nat64), token_logo: e3.Opt(e3.Text), token_name: e3.Opt(e3.Text) }), Re = e3.Record({ motion_text: e3.Text }), ve = e3.Variant({ ManageNervousSystemParameters: O, AddGenericNervousSystemFunction: c3, ManageDappCanisterSettings: _e, RemoveGenericNervousSystemFunction: e3.Nat64, UpgradeSnsToNextVersion: e3.Record({}), RegisterDappCanisters: de2, TransferSnsTreasuryFunds: pe2, UpgradeSnsControlledCanister: ue2, DeregisterDappCanisters: le, MintSnsTokens: me2, AdvanceSnsTargetVersion: Ne, Unspecified: e3.Record({}), ManageSnsMetadata: C2, ExecuteGenericNervousSystemFunction: Oe, ManageLedgerParameters: ge2, Motion: Re }), R2 = e3.Record({ url: e3.Text, title: e3.Text, action: e3.Opt(ve), summary: e3.Text }), ye = e3.Record({ current_deadline_timestamp_seconds: e3.Nat64 }), v2 = e3.Record({ id: e3.Opt(_2), payload_text_rendering: e3.Opt(e3.Text), action: e3.Nat64, failure_reason: e3.Opt(N2), action_auxiliary: e3.Opt(re), ballots: e3.Vec(e3.Tuple(e3.Text, ie2)), minimum_yes_proportion_of_total: e3.Opt(F), reward_event_round: e3.Nat64, failed_timestamp_seconds: e3.Nat64, reward_event_end_timestamp_seconds: e3.Opt(e3.Nat64), proposal_creation_timestamp_seconds: e3.Nat64, initial_voting_period_seconds: e3.Nat64, reject_cost_e8s: e3.Nat64, latest_tally: e3.Opt(ce), wait_for_quiet_deadline_increase_seconds: e3.Nat64, decided_timestamp_seconds: e3.Nat64, proposal: e3.Opt(R2), proposer: e3.Opt(r), wait_for_quiet_state: e3.Opt(ye), minimum_yes_proportion_of_exercised: e3.Opt(F), is_eligible_for_rewards: e3.Bool, executed_timestamp_seconds: e3.Nat64 }), k2 = e3.Record({ memo: e3.Nat64, amount_e8s: e3.Nat64 }), A2 = e3.Record({ function_id: e3.Nat64, followees: e3.Vec(r) }), q = e3.Record({ to_account: e3.Opt(p3), percentage_to_disburse: e3.Nat32 }), Se = e3.Record({ requested_setting_for_auto_stake_maturity: e3.Bool }), fe2 = e3.Record({ additional_dissolve_delay_seconds: e3.Nat32 }), Ve = e3.Record({ dissolve_timestamp_seconds: e3.Nat64 }), we = e3.Variant({ ChangeAutoStakeMaturity: Se, StopDissolving: e3.Record({}), StartDissolving: e3.Record({}), IncreaseDissolveDelay: fe2, SetDissolveTimestamp: Ve }), G2 = e3.Record({ operation: e3.Opt(we) }), U3 = e3.Record({ vote: e3.Int32, proposal: e3.Opt(_2) }), Te = e3.Record({ amount_to_be_disbursed_e8s: e3.Nat64, to_account: e3.Opt(p3) }), Pe = e3.Record({ controller: e3.Opt(e3.Principal), memo: e3.Nat64 }), he = e3.Variant({ MemoAndController: Pe, NeuronId: e3.Record({}) }), E2 = e3.Record({ by: e3.Opt(he) }), B2 = e3.Record({ permissions_to_remove: e3.Opt(m3), principal_id: e3.Opt(e3.Principal) }), z = e3.Record({ permissions_to_add: e3.Opt(m3), principal_id: e3.Opt(e3.Principal) }), j2 = e3.Record({ percentage_to_merge: e3.Nat32 }), be = e3.Record({ e8s: e3.Nat64 }), J = e3.Record({ to_account: e3.Opt(p3), amount: e3.Opt(be) }), Me = e3.Variant({ Split: k2, Follow: A2, DisburseMaturity: q, Configure: G2, RegisterVote: U3, SyncCommand: e3.Record({}), MakeProposal: R2, FinalizeDisburseMaturity: Te, ClaimOrRefreshNeuron: E2, RemoveNeuronPermissions: B2, AddNeuronPermissions: z, MergeMaturity: j2, Disburse: J }), xe = e3.Record({ command: e3.Opt(Me), timestamp: e3.Nat64 }), Fe = e3.Record({ principal: e3.Opt(e3.Principal), permission_type: e3.Vec(e3.Int32) }), Ce = e3.Variant({ DissolveDelaySeconds: e3.Nat64, WhenDissolvedTimestampSeconds: e3.Nat64 }), ke = e3.Record({ timestamp_of_disbursement_seconds: e3.Nat64, amount_e8s: e3.Nat64, account_to_disburse_to: e3.Opt(p3), finalize_disbursement_timestamp_seconds: e3.Opt(e3.Nat64) }), y = e3.Record({ id: e3.Opt(r), staked_maturity_e8s_equivalent: e3.Opt(e3.Nat64), permissions: e3.Vec(Fe), maturity_e8s_equivalent: e3.Nat64, cached_neuron_stake_e8s: e3.Nat64, created_timestamp_seconds: e3.Nat64, source_nns_neuron_id: e3.Opt(e3.Nat64), auto_stake_maturity: e3.Opt(e3.Bool), aging_since_timestamp_seconds: e3.Nat64, dissolve_state: e3.Opt(Ce), voting_power_percentage_multiplier: e3.Nat64, vesting_period_seconds: e3.Opt(e3.Nat64), disburse_maturity_in_progress: e3.Vec(ke), followees: e3.Vec(e3.Tuple(e3.Nat64, P2)), neuron_fees_e8s: e3.Nat64 }), Wt = e3.Record({ root_canister_id: e3.Opt(e3.Principal), timers: e3.Opt(o), cached_upgrade_steps: e3.Opt(i), id_to_nervous_system_functions: e3.Vec(e3.Tuple(e3.Nat64, c3)), metrics: e3.Opt(l), maturity_modulation: e3.Opt(w3), upgrade_journal: e3.Opt(T3), mode: e3.Int32, parameters: e3.Opt(O), is_finalizing_disburse_maturity: e3.Opt(e3.Bool), deployed_version: e3.Opt(t2), sns_initialization_parameters: e3.Text, latest_reward_event: e3.Opt(h3), pending_version: e3.Opt(te), swap_canister_id: e3.Opt(e3.Principal), ledger_canister_id: e3.Opt(e3.Principal), proposals: e3.Vec(e3.Tuple(e3.Nat64, v2)), in_flight_commands: e3.Vec(e3.Tuple(e3.Text, xe)), sns_metadata: e3.Opt(C2), neurons: e3.Vec(e3.Tuple(e3.Text, y)), target_version: e3.Opt(t2), genesis_timestamp_seconds: e3.Nat64 }), Ae = e3.Record({ principals: e3.Vec(e3.Principal) }), qe = e3.Record({ nns_neuron_hotkeys: e3.Opt(Ae), nns_neuron_controller: e3.Opt(e3.Principal), nns_neuron_id: e3.Opt(e3.Nat64) }), Ge = e3.Variant({ NeuronsFund: qe, Direct: e3.Record({}) }), Ue = e3.Record({ neuron_ids: e3.Vec(r) }), Ee = e3.Record({ controller: e3.Opt(e3.Principal), dissolve_delay_seconds: e3.Opt(e3.Nat64), participant: e3.Opt(Ge), stake_e8s: e3.Opt(e3.Nat64), followees: e3.Opt(Ue), neuron_id: e3.Opt(r) }), Be = e3.Record({ neuron_recipes: e3.Vec(Ee) }), ze = e3.Record({ neuron_recipes: e3.Opt(Be) }), je = e3.Record({ id: e3.Opt(r), status: e3.Int32 }), Je = e3.Record({ swap_neurons: e3.Vec(je) }), Qe = e3.Variant({ Ok: Je, Err: e3.Int32 }), We = e3.Record({ claim_swap_neurons_result: e3.Opt(Qe) }), $e = e3.Record({ maturity_modulation: e3.Opt(w3) }), Xe = e3.Record({ url: e3.Opt(e3.Text), logo: e3.Opt(e3.Text), name: e3.Opt(e3.Text), description: e3.Opt(e3.Text) }), He = e3.Record({ mode: e3.Opt(e3.Int32) }), Ke = e3.Record({ neuron_id: e3.Opt(r) }), Ye = e3.Variant({ Error: N2, Neuron: y }), Ze = e3.Record({ result: e3.Opt(Ye) }), Q = e3.Record({ proposal_id: e3.Opt(_2) }), De = e3.Variant({ Error: N2, Proposal: v2 }), Ie = e3.Record({ result: e3.Opt(De) }), Le = e3.Variant({ stopped: e3.Null, stopping: e3.Null, running: e3.Null }), et = e3.Record({ freezing_threshold: e3.Nat, controllers: e3.Vec(e3.Principal), wasm_memory_limit: e3.Opt(e3.Nat), memory_allocation: e3.Nat, compute_allocation: e3.Nat }), tt = e3.Record({ status: Le, memory_size: e3.Nat, cycles: e3.Nat, settings: et, idle_cycles_burned_per_day: e3.Nat, module_hash: e3.Opt(e3.Vec(e3.Nat8)) }), st = e3.Record({ deployed_version: e3.Opt(t2), pending_version: e3.Opt(e3.Record({ mark_failed_at_seconds: e3.Nat64, checking_upgrade_lock: e3.Nat64, proposal_id: e3.Nat64, target_version: e3.Opt(t2) })) }), ot = e3.Record({ sns_initialization_parameters: e3.Text }), nt = e3.Record({ timers: e3.Opt(o) }), at2 = e3.Record({ offset: e3.Opt(e3.Nat64), limit: e3.Opt(e3.Nat64) }), rt = e3.Record({ upgrade_journal: e3.Opt(T3), upgrade_steps: e3.Opt(s2), response_timestamp_seconds: e3.Opt(e3.Nat64), deployed_version: e3.Opt(t2), target_version: e3.Opt(t2), upgrade_journal_entry_count: e3.Opt(e3.Nat64) }), it = e3.Record({ reserved_ids: e3.Vec(e3.Nat64), functions: e3.Vec(c3) }), ct = e3.Record({ of_principal: e3.Opt(e3.Principal), limit: e3.Nat32, start_page_at: e3.Opt(r) }), _t = e3.Record({ neurons: e3.Vec(y) }), dt = e3.Record({ include_reward_status: e3.Vec(e3.Int32), before_proposal: e3.Opt(_2), limit: e3.Nat32, exclude_type: e3.Vec(e3.Nat64), include_status: e3.Vec(e3.Int32) }), pt = e3.Record({ include_ballots_by_caller: e3.Opt(e3.Bool), proposals: e3.Vec(v2) }), ut2 = e3.Record({ percentage_to_stake: e3.Opt(e3.Nat32) }), lt2 = e3.Variant({ Split: k2, Follow: A2, DisburseMaturity: q, ClaimOrRefresh: E2, Configure: G2, RegisterVote: U3, MakeProposal: R2, StakeMaturity: ut2, RemoveNeuronPermissions: B2, AddNeuronPermissions: z, MergeMaturity: j2, Disburse: J }), mt = e3.Record({ subaccount: e3.Vec(e3.Nat8), command: e3.Opt(lt2) }), Nt = e3.Record({ created_neuron_id: e3.Opt(r) }), Ot = e3.Record({ amount_disbursed_e8s: e3.Nat64, amount_deducted_e8s: e3.Opt(e3.Nat64) }), gt2 = e3.Record({ refreshed_neuron_id: e3.Opt(r) }), Rt = e3.Record({ maturity_e8s: e3.Nat64, staked_maturity_e8s: e3.Nat64 }), vt = e3.Record({ merged_maturity_e8s: e3.Nat64, new_stake_e8s: e3.Nat64 }), yt2 = e3.Record({ transfer_block_height: e3.Nat64 }), St = e3.Variant({ Error: N2, Split: Nt, Follow: e3.Record({}), DisburseMaturity: Ot, ClaimOrRefresh: gt2, Configure: e3.Record({}), RegisterVote: e3.Record({}), MakeProposal: Q, RemoveNeuronPermission: e3.Record({}), StakeMaturity: Rt, MergeMaturity: vt, Disburse: yt2, AddNeuronPermission: e3.Record({}) }), ft = e3.Record({ command: e3.Opt(St) }), Vt = e3.Record({ mode: e3.Int32 });
    return e3.Service({ claim_swap_neurons: e3.Func([ze], [We], []), fail_stuck_upgrade_in_progress: e3.Func([e3.Record({})], [e3.Record({})], []), get_build_metadata: e3.Func([], [e3.Text], ["query"]), get_latest_reward_event: e3.Func([], [h3], ["query"]), get_maturity_modulation: e3.Func([e3.Record({})], [$e], []), get_metadata: e3.Func([e3.Record({})], [Xe], ["query"]), get_mode: e3.Func([e3.Record({})], [He], ["query"]), get_nervous_system_parameters: e3.Func([e3.Null], [O], ["query"]), get_neuron: e3.Func([Ke], [Ze], ["query"]), get_proposal: e3.Func([Q], [Ie], ["query"]), get_root_canister_status: e3.Func([e3.Null], [tt], []), get_running_sns_version: e3.Func([e3.Record({})], [st], ["query"]), get_sns_initialization_parameters: e3.Func([e3.Record({})], [ot], ["query"]), get_timers: e3.Func([e3.Record({})], [nt], ["query"]), get_upgrade_journal: e3.Func([at2], [rt], ["query"]), list_nervous_system_functions: e3.Func([], [it], ["query"]), list_neurons: e3.Func([ct], [_t], ["query"]), list_proposals: e3.Func([dt], [pt], ["query"]), manage_neuron: e3.Func([mt], [ft], []), reset_timers: e3.Func([e3.Record({})], [e3.Record({})], []), set_mode: e3.Func([Vt], [e3.Record({})], []) });
  };
  var f = ({ neuronId: { id: e3 }, command: o }) => ({ subaccount: e3, command: [o] });
  var W = ({ neuronId: e3, operation: o }) => f({ neuronId: e3, command: { Configure: { operation: [o] } } });
  var ht = ({ owner: e3, subaccount: o }) => ({ owner: Mt(e3), subaccount: o === void 0 ? [] : Mt({ subaccount: o }) });
  var bt = ({ neuronId: e3, permissions: o, principal: t2 }) => f({ neuronId: e3, command: { AddNeuronPermissions: { permissions_to_add: [{ permissions: Int32Array.from(o) }], principal_id: [t2] } } });
  var Mt2 = ({ neuronId: e3, permissions: o, principal: t2 }) => f({ neuronId: e3, command: { RemoveNeuronPermissions: { permissions_to_remove: [{ permissions: Int32Array.from(o) }], principal_id: [t2] } } });
  var xt2 = ({ neuronId: e3, memo: o, amount: t2 }) => f({ neuronId: e3, command: { Split: { memo: o, amount_e8s: t2 } } });
  var Ft = ({ neuronId: e3, amount: o, toAccount: t2 }) => f({ neuronId: e3, command: { Disburse: { to_account: t2 === void 0 ? [] : Mt(ht(t2)), amount: o === void 0 ? [] : [{ e8s: o }] } } });
  var Ct = (e3) => W({ neuronId: e3, operation: { StartDissolving: {} } });
  var kt = (e3) => W({ neuronId: e3, operation: { StopDissolving: {} } });
  var At2 = ({ neuronId: e3, percentageToStake: o }) => f({ neuronId: e3, command: { StakeMaturity: { percentage_to_stake: Mt(o) } } });
  var qt = ({ neuronId: e3, percentageToDisburse: o, toAccount: t2 }) => f({ neuronId: e3, command: { DisburseMaturity: { to_account: t2 === void 0 ? [] : Mt(ht(t2)), percentage_to_disburse: o } } });
  var Gt = ({ neuronId: e3, autoStake: o }) => W({ neuronId: e3, operation: { ChangeAutoStakeMaturity: { requested_setting_for_auto_stake_maturity: o } } });
  var Ut = ({ neuronId: e3, dissolveTimestampSeconds: o }) => W({ neuronId: e3, operation: { SetDissolveTimestamp: { dissolve_timestamp_seconds: o } } });
  var Et = ({ neuronId: e3, additionalDissolveDelaySeconds: o }) => W({ neuronId: e3, operation: { IncreaseDissolveDelay: { additional_dissolve_delay_seconds: o } } });
  var Bt = ({ neuronId: e3, functionId: o, followees: t2 }) => ({ subaccount: e3.id, command: [{ Follow: { function_id: o, followees: t2 } }] });
  var zt = ({ neuronId: e3, proposalId: o, vote: t2 }) => ({ subaccount: e3.id, command: [{ RegisterVote: { vote: t2, proposal: [o] } }] });
  var wt = ({ subaccount: e3, memo: o, controller: t2 }) => ({ subaccount: e3, command: [{ ClaimOrRefresh: { by: [o === void 0 ? { NeuronId: {} } : { MemoAndController: { memo: o, controller: Mt(t2) } }] } }] });
  var jt = ({ excludeType: e3, beforeProposal: o, includeRewardStatus: t2, includeStatus: s2, limit: i }) => ({ exclude_type: BigUint64Array.from(e3 ?? []), before_proposal: Mt(o), include_reward_status: Int32Array.from(t2 ?? []), include_status: Int32Array.from(s2 ?? []), limit: i ?? 10 });
  var Qt = class e extends U {
    constructor() {
      super(...arguments);
      this.listNeurons = async (t2) => {
        let { principal: s2, limit: i, beforeNeuronId: a } = t2, { neurons: d2 } = await this.caller(t2).list_neurons({ of_principal: Mt(s2), limit: i ?? 100, start_page_at: Mt(a) });
        return d2;
      };
      this.listProposals = async (t2) => {
        let { certified: s2 } = t2;
        return await this.caller({ certified: s2 }).list_proposals(jt(t2));
      };
      this.getProposal = async (t2) => {
        let { proposalId: s2 } = t2, { result: i } = await this.caller(t2).get_proposal({ proposal_id: Mt(s2) }), a = j(i);
        if (a === void 0 || "Error" in a)
          throw new t(a?.Error.error_message ?? "Response type not supported");
        return a.Proposal;
      };
      this.listNervousSystemFunctions = async (t2) => this.caller(t2).list_nervous_system_functions();
      this.metadata = (t2) => this.caller(t2).get_metadata({});
      this.nervousSystemParameters = (t2) => this.caller(t2).get_nervous_system_parameters(null);
      this.getNeuron = async (t2) => {
        let { neuronId: s2 } = t2, { result: i } = await this.caller(t2).get_neuron({ neuron_id: Mt(s2) }), a = j(i);
        if (a === void 0 || "Error" in a)
          throw new t(a?.Error.error_message ?? "Response type not supported");
        return a.Neuron;
      };
      this.queryNeuron = async (t2) => {
        try {
          return await this.getNeuron(t2);
        } catch (s2) {
          if (s2 instanceof Error && s2.message.includes("No neuron for given NeuronId"))
            return;
          throw s2;
        }
      };
      this.manageNeuron = async (t2) => {
        let s2 = await this.caller({ certified: true }).manage_neuron(t2);
        return this.assertManageNeuronError(s2), s2;
      };
      this.addNeuronPermissions = async (t2) => {
        let s2 = bt(t2);
        await this.manageNeuron(s2);
      };
      this.removeNeuronPermissions = async (t2) => {
        let s2 = Mt2(t2);
        await this.manageNeuron(s2);
      };
      this.splitNeuron = async (t2) => {
        let s2 = xt2(t2), { command: i } = await this.manageNeuron(s2), a = j(i), d2 = (c3) => `Split neuron failed (${c3})`;
        if (a === void 0)
          throw new t(d2("no response"));
        if ("Split" in a) {
          let c3 = a.Split, l = j(c3.created_neuron_id);
          if (l !== void 0)
            return l;
          throw new t(d2("no id"));
        }
        throw new t(d2("unknown"));
      };
      this.disburse = async (t2) => {
        let s2 = Ft(t2);
        await this.manageNeuron(s2);
      };
      this.startDissolving = async (t2) => {
        let s2 = Ct(t2);
        await this.manageNeuron(s2);
      };
      this.stopDissolving = async (t2) => {
        let s2 = kt(t2);
        await this.manageNeuron(s2);
      };
      this.stakeMaturity = async ({ neuronId: t2, percentageToStake: s2 }) => {
        xt(s2 ?? 100);
        let i = At2({ neuronId: t2, percentageToStake: s2 });
        await this.manageNeuron(i);
      };
      this.disburseMaturity = async (t2) => {
        xt(t2.percentageToDisburse);
        let s2 = qt(t2);
        await this.manageNeuron(s2);
      };
      this.autoStakeMaturity = async (t2) => {
        let s2 = Gt(t2);
        await this.manageNeuron(s2);
      };
      this.setDissolveTimestamp = async (t2) => {
        let s2 = Ut(t2);
        await this.manageNeuron(s2);
      };
      this.increaseDissolveDelay = async (t2) => {
        let s2 = Et(t2);
        await this.manageNeuron(s2);
      };
      this.setTopicFollowees = async (t2) => {
        let s2 = Bt(t2);
        await this.manageNeuron(s2);
      };
      this.registerVote = async (t2) => {
        let s2 = zt(t2);
        await this.manageNeuron(s2);
      };
      this.refreshNeuron = async (t2) => {
        let s2 = wt({ subaccount: t2.id });
        await this.manageNeuron(s2);
      };
      this.claimNeuron = async ({ memo: t2, controller: s2, subaccount: i }) => {
        let a = wt({ subaccount: i, memo: t2, controller: s2 }), { command: d2 } = await this.manageNeuron(a), c3 = j(d2);
        if (c3 === void 0)
          throw new t("Claim neuron failed");
        if ("ClaimOrRefresh" in c3) {
          let l = j(c3.ClaimOrRefresh.refreshed_neuron_id);
          if (l === void 0)
            throw new t("Claim neuron failed");
          return l;
        }
        throw new t("Claim neuron failed");
      };
      this.assertManageNeuronError = ({ command: t2 }) => {
        let s2 = t2[0];
        if (s2 !== void 0 && "Error" in s2)
          throw new t(s2.Error.error_message);
      };
    }
    static create(t2) {
      let { service: s2, certifiedService: i, canisterId: a } = at({ options: t2, idlFactory: Pt, certifiedIdlFactory: Tt });
      return new e(a, s2, i);
    }
  };

  // node_modules/@dfinity/sns/dist/esm/chunk-Q55ZUKOX.js
  function D(t2) {
    return t2 instanceof Uint8Array || t2 != null && typeof t2 == "object" && t2.constructor.name === "Uint8Array";
  }
  function w2(t2, ...e3) {
    if (!D(t2))
      throw new Error("Uint8Array expected");
    if (e3.length > 0 && !e3.includes(t2.length))
      throw new Error(`Uint8Array expected of length ${e3}, not of length=${t2.length}`);
  }
  function v(t2, e3 = true) {
    if (t2.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (e3 && t2.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function k(t2, e3) {
    w2(t2);
    let r = e3.outputLen;
    if (t2.length < r)
      throw new Error(`digestInto() expects output buffer of length at least ${r}`);
  }
  var P = (t2) => new DataView(t2.buffer, t2.byteOffset, t2.byteLength);
  var m2 = (t2, e3) => t2 << 32 - e3 | t2 >>> e3;
  var $ = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
  function _(t2) {
    if (typeof t2 != "string")
      throw new Error(`utf8ToBytes expected string, got ${typeof t2}`);
    return new Uint8Array(new TextEncoder().encode(t2));
  }
  function N(t2) {
    return typeof t2 == "string" && (t2 = _(t2)), w2(t2), t2;
  }
  var x2 = class {
    clone() {
      return this._cloneInto();
    }
  };
  var W2 = {}.toString;
  function A(t2) {
    let e3 = (s2) => t2().update(N(s2)).digest(), r = t2();
    return e3.outputLen = r.outputLen, e3.blockLen = r.blockLen, e3.create = () => t2(), e3;
  }
  function G(t2, e3, r, s2) {
    if (typeof t2.setBigUint64 == "function")
      return t2.setBigUint64(e3, r, s2);
    let n2 = BigInt(32), o = BigInt(4294967295), i = Number(r >> n2 & o), a = Number(r & o), u2 = s2 ? 4 : 0, f4 = s2 ? 0 : 4;
    t2.setUint32(e3 + u2, i, s2), t2.setUint32(e3 + f4, a, s2);
  }
  var C = (t2, e3, r) => t2 & e3 ^ ~t2 & r;
  var B = (t2, e3, r) => t2 & e3 ^ t2 & r ^ e3 & r;
  var b2 = class extends x2 {
    constructor(e3, r, s2, n2) {
      super(), this.blockLen = e3, this.outputLen = r, this.padOffset = s2, this.isLE = n2, this.finished = false, this.length = 0, this.pos = 0, this.destroyed = false, this.buffer = new Uint8Array(e3), this.view = P(this.buffer);
    }
    update(e3) {
      v(this);
      let { view: r, buffer: s2, blockLen: n2 } = this;
      e3 = N(e3);
      let o = e3.length;
      for (let i = 0; i < o; ) {
        let a = Math.min(n2 - this.pos, o - i);
        if (a === n2) {
          let u2 = P(e3);
          for (; n2 <= o - i; i += n2)
            this.process(u2, i);
          continue;
        }
        s2.set(e3.subarray(i, i + a), this.pos), this.pos += a, i += a, this.pos === n2 && (this.process(r, 0), this.pos = 0);
      }
      return this.length += e3.length, this.roundClean(), this;
    }
    digestInto(e3) {
      v(this), k(e3, this), this.finished = true;
      let { buffer: r, view: s2, blockLen: n2, isLE: o } = this, { pos: i } = this;
      r[i++] = 128, this.buffer.subarray(i).fill(0), this.padOffset > n2 - i && (this.process(s2, 0), i = 0);
      for (let c3 = i; c3 < n2; c3++)
        r[c3] = 0;
      G(s2, n2 - 8, BigInt(this.length * 8), o), this.process(s2, 0);
      let a = P(e3), u2 = this.outputLen;
      if (u2 % 4)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      let f4 = u2 / 4, d2 = this.get();
      if (f4 > d2.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let c3 = 0; c3 < f4; c3++)
        a.setUint32(4 * c3, d2[c3], o);
    }
    digest() {
      let { buffer: e3, outputLen: r } = this;
      this.digestInto(e3);
      let s2 = e3.slice(0, r);
      return this.destroy(), s2;
    }
    _cloneInto(e3) {
      e3 || (e3 = new this.constructor()), e3.set(...this.get());
      let { blockLen: r, buffer: s2, length: n2, finished: o, destroyed: i, pos: a } = this;
      return e3.length = n2, e3.pos = a, e3.finished = o, e3.destroyed = i, n2 % r && e3.buffer.set(s2), e3;
    }
  };
  var E = new Uint32Array([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]);
  var p2 = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  var h2 = new Uint32Array(64);
  var I = class extends b2 {
    constructor() {
      super(64, 32, 8, false), this.A = p2[0] | 0, this.B = p2[1] | 0, this.C = p2[2] | 0, this.D = p2[3] | 0, this.E = p2[4] | 0, this.F = p2[5] | 0, this.G = p2[6] | 0, this.H = p2[7] | 0;
    }
    get() {
      let { A: e3, B: r, C: s2, D: n2, E: o, F: i, G: a, H: u2 } = this;
      return [e3, r, s2, n2, o, i, a, u2];
    }
    set(e3, r, s2, n2, o, i, a, u2) {
      this.A = e3 | 0, this.B = r | 0, this.C = s2 | 0, this.D = n2 | 0, this.E = o | 0, this.F = i | 0, this.G = a | 0, this.H = u2 | 0;
    }
    process(e3, r) {
      for (let c3 = 0; c3 < 16; c3++, r += 4)
        h2[c3] = e3.getUint32(r, false);
      for (let c3 = 16; c3 < 64; c3++) {
        let g3 = h2[c3 - 15], l = h2[c3 - 2], T3 = m2(g3, 7) ^ m2(g3, 18) ^ g3 >>> 3, S2 = m2(l, 17) ^ m2(l, 19) ^ l >>> 10;
        h2[c3] = S2 + h2[c3 - 7] + T3 + h2[c3 - 16] | 0;
      }
      let { A: s2, B: n2, C: o, D: i, E: a, F: u2, G: f4, H: d2 } = this;
      for (let c3 = 0; c3 < 64; c3++) {
        let g3 = m2(a, 6) ^ m2(a, 11) ^ m2(a, 25), l = d2 + g3 + C(a, u2, f4) + E[c3] + h2[c3] | 0, S2 = (m2(s2, 2) ^ m2(s2, 13) ^ m2(s2, 22)) + B(s2, n2, o) | 0;
        d2 = f4, f4 = u2, u2 = a, a = i + l | 0, i = o, o = n2, n2 = s2, s2 = l + S2 | 0;
      }
      s2 = s2 + this.A | 0, n2 = n2 + this.B | 0, o = o + this.C | 0, i = i + this.D | 0, a = a + this.E | 0, u2 = u2 + this.F | 0, f4 = f4 + this.G | 0, d2 = d2 + this.H | 0, this.set(s2, n2, o, i, a, u2, f4, d2);
    }
    roundClean() {
      h2.fill(0);
    }
    destroy() {
      this.set(0, 0, 0, 0, 0, 0, 0, 0), this.buffer.fill(0);
    }
  };
  var L = A(() => new I());

  // node_modules/@dfinity/ledger-icrc/dist/esm/index.js
  init_esm();
  var s = ((e3) => (e3.SYMBOL = "icrc1:symbol", e3.NAME = "icrc1:name", e3.DECIMALS = "icrc1:decimals", e3.FEE = "icrc1:fee", e3.LOGO = "icrc1:logo", e3))(s || {});

  // node_modules/@dfinity/sns/dist/esm/index.js
  var Ct3 = ((a) => (a[a.NEURON_PERMISSION_TYPE_UNSPECIFIED = 0] = "NEURON_PERMISSION_TYPE_UNSPECIFIED", a[a.NEURON_PERMISSION_TYPE_CONFIGURE_DISSOLVE_STATE = 1] = "NEURON_PERMISSION_TYPE_CONFIGURE_DISSOLVE_STATE", a[a.NEURON_PERMISSION_TYPE_MANAGE_PRINCIPALS = 2] = "NEURON_PERMISSION_TYPE_MANAGE_PRINCIPALS", a[a.NEURON_PERMISSION_TYPE_SUBMIT_PROPOSAL = 3] = "NEURON_PERMISSION_TYPE_SUBMIT_PROPOSAL", a[a.NEURON_PERMISSION_TYPE_VOTE = 4] = "NEURON_PERMISSION_TYPE_VOTE", a[a.NEURON_PERMISSION_TYPE_DISBURSE = 5] = "NEURON_PERMISSION_TYPE_DISBURSE", a[a.NEURON_PERMISSION_TYPE_SPLIT = 6] = "NEURON_PERMISSION_TYPE_SPLIT", a[a.NEURON_PERMISSION_TYPE_MERGE_MATURITY = 7] = "NEURON_PERMISSION_TYPE_MERGE_MATURITY", a[a.NEURON_PERMISSION_TYPE_DISBURSE_MATURITY = 8] = "NEURON_PERMISSION_TYPE_DISBURSE_MATURITY", a[a.NEURON_PERMISSION_TYPE_STAKE_MATURITY = 9] = "NEURON_PERMISSION_TYPE_STAKE_MATURITY", a[a.NEURON_PERMISSION_TYPE_MANAGE_VOTING_PERMISSION = 10] = "NEURON_PERMISSION_TYPE_MANAGE_VOTING_PERMISSION", a))(Ct3 || {});
  var At3 = ((i) => (i[i.PROPOSAL_REWARD_STATUS_UNSPECIFIED = 0] = "PROPOSAL_REWARD_STATUS_UNSPECIFIED", i[i.PROPOSAL_REWARD_STATUS_ACCEPT_VOTES = 1] = "PROPOSAL_REWARD_STATUS_ACCEPT_VOTES", i[i.PROPOSAL_REWARD_STATUS_READY_TO_SETTLE = 2] = "PROPOSAL_REWARD_STATUS_READY_TO_SETTLE", i[i.PROPOSAL_REWARD_STATUS_SETTLED = 3] = "PROPOSAL_REWARD_STATUS_SETTLED", i))(At3 || {});
  var kt2 = ((s2) => (s2[s2.PROPOSAL_DECISION_STATUS_UNSPECIFIED = 0] = "PROPOSAL_DECISION_STATUS_UNSPECIFIED", s2[s2.PROPOSAL_DECISION_STATUS_OPEN = 1] = "PROPOSAL_DECISION_STATUS_OPEN", s2[s2.PROPOSAL_DECISION_STATUS_REJECTED = 2] = "PROPOSAL_DECISION_STATUS_REJECTED", s2[s2.PROPOSAL_DECISION_STATUS_ADOPTED = 3] = "PROPOSAL_DECISION_STATUS_ADOPTED", s2[s2.PROPOSAL_DECISION_STATUS_EXECUTED = 4] = "PROPOSAL_DECISION_STATUS_EXECUTED", s2[s2.PROPOSAL_DECISION_STATUS_FAILED = 5] = "PROPOSAL_DECISION_STATUS_FAILED", s2))(kt2 || {});
  var Et2 = ((o) => (o[o.Unspecified = 0] = "Unspecified", o[o.Yes = 1] = "Yes", o[o.No = 2] = "No", o))(Et2 || {});
  var Ut3 = ((s2) => (s2[s2.Unspecified = 0] = "Unspecified", s2[s2.Pending = 1] = "Pending", s2[s2.Open = 2] = "Open", s2[s2.Committed = 3] = "Committed", s2[s2.Aborted = 4] = "Aborted", s2[s2.Adopted = 5] = "Adopted", s2))(Ut3 || {});
  var Gt2 = ((o) => (o[o.TYPE_UNSPECIFIED = 0] = "TYPE_UNSPECIFIED", o[o.TYPE_SALE_NOT_OPEN = 1] = "TYPE_SALE_NOT_OPEN", o[o.TYPE_SALE_CLOSED = 2] = "TYPE_SALE_CLOSED", o))(Gt2 || {});
  var qt2 = ((r) => (r[r.TYPE_UNSPECIFIED = 0] = "TYPE_UNSPECIFIED", r[r.TYPE_SALE_NOT_OPEN = 1] = "TYPE_SALE_NOT_OPEN", r[r.TYPE_SALE_CLOSED = 2] = "TYPE_SALE_CLOSED", r[r.TYPE_TICKET_EXISTS = 3] = "TYPE_TICKET_EXISTS", r[r.TYPE_INVALID_USER_AMOUNT = 4] = "TYPE_INVALID_USER_AMOUNT", r[r.TYPE_INVALID_SUBACCOUNT = 5] = "TYPE_INVALID_SUBACCOUNT", r[r.TYPE_INVALID_PRINCIPAL = 6] = "TYPE_INVALID_PRINCIPAL", r))(qt2 || {});

  // src/index.ts
  init_esm();

  // node_modules/@dfinity/identity/lib/esm/identity/ed25519.js
  init_ed25519();
  var __classPrivateFieldSet5 = function(receiver, state, value4, kind, f4) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
  };
  var __classPrivateFieldGet5 = function(receiver, state, kind, f4) {
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
  };
  var _Ed25519PublicKey_rawKey2;
  var _Ed25519PublicKey_derKey2;
  var _Ed25519KeyIdentity_publicKey;
  var _Ed25519KeyIdentity_privateKey;
  function isObject(value4) {
    return value4 !== null && typeof value4 === "object";
  }
  var Ed25519PublicKey2 = class _Ed25519PublicKey {
    // `fromRaw` and `fromDer` should be used for instantiation, not this constructor.
    constructor(key) {
      _Ed25519PublicKey_rawKey2.set(this, void 0);
      _Ed25519PublicKey_derKey2.set(this, void 0);
      if (key.byteLength !== _Ed25519PublicKey.RAW_KEY_LENGTH) {
        throw new Error("An Ed25519 public key must be exactly 32bytes long");
      }
      __classPrivateFieldSet5(this, _Ed25519PublicKey_rawKey2, key, "f");
      __classPrivateFieldSet5(this, _Ed25519PublicKey_derKey2, _Ed25519PublicKey.derEncode(key), "f");
    }
    /**
     * Construct Ed25519PublicKey from an existing PublicKey
     * @param {unknown} maybeKey - existing PublicKey, ArrayBuffer, DerEncodedPublicKey, or hex string
     * @returns {Ed25519PublicKey} Instance of Ed25519PublicKey
     */
    static from(maybeKey) {
      if (typeof maybeKey === "string") {
        const key = fromHex(maybeKey);
        return this.fromRaw(key);
      } else if (isObject(maybeKey)) {
        const key = maybeKey;
        if (isObject(key) && Object.hasOwnProperty.call(key, "__derEncodedPublicKey__")) {
          return this.fromDer(key);
        } else if (ArrayBuffer.isView(key)) {
          const view = key;
          return this.fromRaw(bufFromBufLike(view.buffer));
        } else if (key instanceof ArrayBuffer) {
          return this.fromRaw(key);
        } else if ("rawKey" in key) {
          return this.fromRaw(key.rawKey);
        } else if ("derKey" in key) {
          return this.fromDer(key.derKey);
        } else if ("toDer" in key) {
          return this.fromDer(key.toDer());
        }
      }
      throw new Error("Cannot construct Ed25519PublicKey from the provided key.");
    }
    static fromRaw(rawKey) {
      return new _Ed25519PublicKey(rawKey);
    }
    static fromDer(derKey) {
      return new _Ed25519PublicKey(this.derDecode(derKey));
    }
    static derEncode(publicKey) {
      const key = wrapDER(publicKey, ED25519_OID).buffer;
      key.__derEncodedPublicKey__ = void 0;
      return key;
    }
    static derDecode(key) {
      const unwrapped = unwrapDER(key, ED25519_OID);
      if (unwrapped.length !== this.RAW_KEY_LENGTH) {
        throw new Error("An Ed25519 public key must be exactly 32bytes long");
      }
      return unwrapped;
    }
    get rawKey() {
      return __classPrivateFieldGet5(this, _Ed25519PublicKey_rawKey2, "f");
    }
    get derKey() {
      return __classPrivateFieldGet5(this, _Ed25519PublicKey_derKey2, "f");
    }
    toDer() {
      return this.derKey;
    }
    toRaw() {
      return this.rawKey;
    }
  };
  _Ed25519PublicKey_rawKey2 = /* @__PURE__ */ new WeakMap(), _Ed25519PublicKey_derKey2 = /* @__PURE__ */ new WeakMap();
  Ed25519PublicKey2.RAW_KEY_LENGTH = 32;
  var Ed25519KeyIdentity = class _Ed25519KeyIdentity extends SignIdentity {
    // `fromRaw` and `fromDer` should be used for instantiation, not this constructor.
    constructor(publicKey, privateKey) {
      super();
      _Ed25519KeyIdentity_publicKey.set(this, void 0);
      _Ed25519KeyIdentity_privateKey.set(this, void 0);
      __classPrivateFieldSet5(this, _Ed25519KeyIdentity_publicKey, Ed25519PublicKey2.from(publicKey), "f");
      __classPrivateFieldSet5(this, _Ed25519KeyIdentity_privateKey, new Uint8Array(privateKey), "f");
    }
    /**
     * Generate a new Ed25519KeyIdentity.
     * @param seed a 32-byte seed for the private key. If not provided, a random seed will be generated.
     * @returns Ed25519KeyIdentity
     */
    static generate(seed) {
      if (seed && seed.length !== 32) {
        throw new Error("Ed25519 Seed needs to be 32 bytes long.");
      }
      if (!seed)
        seed = ed25519.utils.randomPrivateKey();
      if (bufEquals(seed, new Uint8Array(new Array(32).fill(0)))) {
        console.warn("Seed is all zeros. This is not a secure seed. Please provide a seed with sufficient entropy if this is a production environment.");
      }
      const sk = new Uint8Array(32);
      for (let i = 0; i < 32; i++)
        sk[i] = new Uint8Array(seed)[i];
      const pk = ed25519.getPublicKey(sk);
      return _Ed25519KeyIdentity.fromKeyPair(pk, sk);
    }
    static fromParsedJson(obj) {
      const [publicKeyDer, privateKeyRaw] = obj;
      return new _Ed25519KeyIdentity(Ed25519PublicKey2.fromDer(fromHex(publicKeyDer)), fromHex(privateKeyRaw));
    }
    static fromJSON(json) {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        if (typeof parsed[0] === "string" && typeof parsed[1] === "string") {
          return this.fromParsedJson([parsed[0], parsed[1]]);
        } else {
          throw new Error("Deserialization error: JSON must have at least 2 items.");
        }
      }
      throw new Error(`Deserialization error: Invalid JSON type for string: ${JSON.stringify(json)}`);
    }
    static fromKeyPair(publicKey, privateKey) {
      return new _Ed25519KeyIdentity(Ed25519PublicKey2.fromRaw(publicKey), privateKey);
    }
    static fromSecretKey(secretKey) {
      const publicKey = ed25519.getPublicKey(new Uint8Array(secretKey));
      return _Ed25519KeyIdentity.fromKeyPair(publicKey, secretKey);
    }
    /**
     * Serialize this key to JSON.
     */
    toJSON() {
      return [toHex(__classPrivateFieldGet5(this, _Ed25519KeyIdentity_publicKey, "f").toDer()), toHex(__classPrivateFieldGet5(this, _Ed25519KeyIdentity_privateKey, "f"))];
    }
    /**
     * Return a copy of the key pair.
     */
    getKeyPair() {
      return {
        secretKey: __classPrivateFieldGet5(this, _Ed25519KeyIdentity_privateKey, "f"),
        publicKey: __classPrivateFieldGet5(this, _Ed25519KeyIdentity_publicKey, "f")
      };
    }
    /**
     * Return the public key.
     */
    getPublicKey() {
      return __classPrivateFieldGet5(this, _Ed25519KeyIdentity_publicKey, "f");
    }
    /**
     * Signs a blob of data, with this identity's private key.
     * @param challenge - challenge to sign with this identity's secretKey, producing a signature
     */
    async sign(challenge) {
      const blob = new Uint8Array(challenge);
      const signature = uint8ToBuf(ed25519.sign(blob, __classPrivateFieldGet5(this, _Ed25519KeyIdentity_privateKey, "f").slice(0, 32)));
      Object.defineProperty(signature, "__signature__", {
        enumerable: false,
        value: void 0
      });
      return signature;
    }
    /**
     * Verify
     * @param sig - signature to verify
     * @param msg - message to verify
     * @param pk - public key
     * @returns - true if the signature is valid, false otherwise
     */
    static verify(sig, msg, pk) {
      const [signature, message, publicKey] = [sig, msg, pk].map((x5) => {
        if (typeof x5 === "string") {
          x5 = fromHex(x5);
        }
        if (x5 instanceof Uint8Array) {
          x5 = x5.buffer;
        }
        return new Uint8Array(x5);
      });
      return ed25519.verify(message, signature, publicKey);
    }
  };
  _Ed25519KeyIdentity_publicKey = /* @__PURE__ */ new WeakMap(), _Ed25519KeyIdentity_privateKey = /* @__PURE__ */ new WeakMap();

  // node_modules/@dfinity/identity/lib/esm/identity/ecdsa.js
  var CryptoError = class _CryptoError extends Error {
    constructor(message) {
      super(message);
      this.message = message;
      Object.setPrototypeOf(this, _CryptoError.prototype);
    }
  };
  function _getEffectiveCrypto(subtleCrypto) {
    if (typeof window !== "undefined" && window["crypto"] && window["crypto"]["subtle"]) {
      return window["crypto"]["subtle"];
    }
    if (subtleCrypto) {
      return subtleCrypto;
    } else if (typeof crypto !== "undefined" && crypto["subtle"]) {
      return crypto.subtle;
    } else {
      throw new CryptoError("Global crypto was not available and none was provided. Please inlcude a SubtleCrypto implementation. See https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto");
    }
  }
  var ECDSAKeyIdentity = class _ECDSAKeyIdentity extends SignIdentity {
    // `fromKeyPair` and `generate` should be used for instantiation, not this constructor.
    constructor(keyPair, derKey, subtleCrypto) {
      super();
      this._keyPair = keyPair;
      this._derKey = derKey;
      this._subtleCrypto = subtleCrypto;
    }
    /**
     * Generates a randomly generated identity for use in calls to the Internet Computer.
     * @param {CryptoKeyOptions} options optional settings
     * @param {CryptoKeyOptions['extractable']} options.extractable - whether the key should allow itself to be used. Set to false for maximum security.
     * @param {CryptoKeyOptions['keyUsages']} options.keyUsages - a list of key usages that the key can be used for
     * @param {CryptoKeyOptions['subtleCrypto']} options.subtleCrypto interface
     * @constructs ECDSAKeyIdentity
     * @returns a {@link ECDSAKeyIdentity}
     */
    static async generate(options) {
      const { extractable = false, keyUsages = ["sign", "verify"], subtleCrypto } = options !== null && options !== void 0 ? options : {};
      const effectiveCrypto = _getEffectiveCrypto(subtleCrypto);
      const keyPair = await effectiveCrypto.generateKey({
        name: "ECDSA",
        namedCurve: "P-256"
      }, extractable, keyUsages);
      const derKey = await effectiveCrypto.exportKey("spki", keyPair.publicKey);
      return new this(keyPair, derKey, effectiveCrypto);
    }
    /**
     * generates an identity from a public and private key. Please ensure that you are generating these keys securely and protect the user's private key
     * @param keyPair a CryptoKeyPair
     * @param subtleCrypto - a SubtleCrypto interface in case one is not available globally
     * @returns an {@link ECDSAKeyIdentity}
     */
    static async fromKeyPair(keyPair, subtleCrypto) {
      const effectiveCrypto = _getEffectiveCrypto(subtleCrypto);
      const derKey = await effectiveCrypto.exportKey("spki", keyPair.publicKey);
      return new _ECDSAKeyIdentity(keyPair, derKey, effectiveCrypto);
    }
    /**
     * Return the internally-used key pair.
     * @returns a CryptoKeyPair
     */
    getKeyPair() {
      return this._keyPair;
    }
    /**
     * Return the public key.
     * @returns an {@link PublicKey & DerCryptoKey}
     */
    getPublicKey() {
      const derKey = this._derKey;
      const key = Object.create(this._keyPair.publicKey);
      key.toDer = function() {
        return derKey;
      };
      return key;
    }
    /**
     * Signs a blob of data, with this identity's private key.
     * @param {ArrayBuffer} challenge - challenge to sign with this identity's secretKey, producing a signature
     * @returns {Promise<Signature>} signature
     */
    async sign(challenge) {
      const params = {
        name: "ECDSA",
        hash: { name: "SHA-256" }
      };
      const signature = await this._subtleCrypto.sign(params, this._keyPair.privateKey, challenge);
      return signature;
    }
  };

  // node_modules/@dfinity/identity/lib/esm/identity/delegation.js
  init_esm();
  var cbor3 = __toESM(require_src2());

  // node_modules/@dfinity/identity/lib/esm/identity/partial.js
  init_esm();
  var __classPrivateFieldSet6 = function(receiver, state, value4, kind, f4) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
  };
  var __classPrivateFieldGet6 = function(receiver, state, kind, f4) {
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
  };
  var _PartialIdentity_inner;
  var PartialIdentity = class {
    constructor(inner) {
      _PartialIdentity_inner.set(this, void 0);
      __classPrivateFieldSet6(this, _PartialIdentity_inner, inner, "f");
    }
    /**
     * The raw public key of this identity.
     */
    get rawKey() {
      return __classPrivateFieldGet6(this, _PartialIdentity_inner, "f").rawKey;
    }
    /**
     * The DER-encoded public key of this identity.
     */
    get derKey() {
      return __classPrivateFieldGet6(this, _PartialIdentity_inner, "f").derKey;
    }
    /**
     * The DER-encoded public key of this identity.
     */
    toDer() {
      return __classPrivateFieldGet6(this, _PartialIdentity_inner, "f").toDer();
    }
    /**
     * The inner {@link PublicKey} used by this identity.
     */
    getPublicKey() {
      return __classPrivateFieldGet6(this, _PartialIdentity_inner, "f");
    }
    /**
     * The {@link Principal} of this identity.
     */
    getPrincipal() {
      return Principal.from(__classPrivateFieldGet6(this, _PartialIdentity_inner, "f").rawKey);
    }
    /**
     * Required for the Identity interface, but cannot implemented for just a public key.
     */
    transformRequest() {
      return Promise.reject("Not implemented. You are attempting to use a partial identity to sign calls, but this identity only has access to the public key.To sign calls, use a DelegationIdentity instead.");
    }
  };
  _PartialIdentity_inner = /* @__PURE__ */ new WeakMap();

  // node_modules/@dfinity/identity/lib/esm/identity/delegation.js
  var __classPrivateFieldSet7 = function(receiver, state, value4, kind, f4) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
  };
  var __classPrivateFieldGet7 = function(receiver, state, kind, f4) {
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
  };
  var __rest2 = function(s2, e3) {
    var t2 = {};
    for (var p3 in s2)
      if (Object.prototype.hasOwnProperty.call(s2, p3) && e3.indexOf(p3) < 0)
        t2[p3] = s2[p3];
    if (s2 != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p3 = Object.getOwnPropertySymbols(s2); i < p3.length; i++) {
        if (e3.indexOf(p3[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s2, p3[i]))
          t2[p3[i]] = s2[p3[i]];
      }
    return t2;
  };
  var _PartialDelegationIdentity_delegation;
  var domainSeparator2 = new TextEncoder().encode("ic-request-auth-delegation");
  var requestDomainSeparator = new TextEncoder().encode("\nic-request");
  function _parseBlob(value4) {
    if (typeof value4 !== "string" || value4.length < 64) {
      throw new Error("Invalid public key.");
    }
    return fromHex(value4);
  }
  var Delegation = class {
    constructor(pubkey, expiration, targets) {
      this.pubkey = pubkey;
      this.expiration = expiration;
      this.targets = targets;
    }
    toCBOR() {
      return cbor3.value.map(Object.assign({ pubkey: cbor3.value.bytes(this.pubkey), expiration: cbor3.value.u64(this.expiration.toString(16), 16) }, this.targets && {
        targets: cbor3.value.array(this.targets.map((t2) => cbor3.value.bytes(t2.toUint8Array())))
      }));
    }
    toJSON() {
      return Object.assign({ expiration: this.expiration.toString(16), pubkey: toHex(this.pubkey) }, this.targets && { targets: this.targets.map((p3) => p3.toHex()) });
    }
  };
  async function _createSingleDelegation(from, to, expiration, targets) {
    const delegation = new Delegation(
      to.toDer(),
      BigInt(+expiration) * BigInt(1e6),
      // In nanoseconds.
      targets
    );
    const challenge = new Uint8Array([
      ...domainSeparator2,
      ...new Uint8Array(requestIdOf(Object.assign({}, delegation)))
    ]);
    const signature = await from.sign(challenge);
    return {
      delegation,
      signature
    };
  }
  var DelegationChain = class _DelegationChain {
    constructor(delegations, publicKey) {
      this.delegations = delegations;
      this.publicKey = publicKey;
    }
    /**
     * Create a delegation chain between two (or more) keys. By default, the expiration time
     * will be very short (15 minutes).
     *
     * To build a chain of more than 2 identities, this function needs to be called multiple times,
     * passing the previous delegation chain into the options argument. For example:
     * @example
     * const rootKey = createKey();
     * const middleKey = createKey();
     * const bottomeKey = createKey();
     *
     * const rootToMiddle = await DelegationChain.create(
     *   root, middle.getPublicKey(), Date.parse('2100-01-01'),
     * );
     * const middleToBottom = await DelegationChain.create(
     *   middle, bottom.getPublicKey(), Date.parse('2100-01-01'), { previous: rootToMiddle },
     * );
     *
     * // We can now use a delegation identity that uses the delegation above:
     * const identity = DelegationIdentity.fromDelegation(bottomKey, middleToBottom);
     * @param from The identity that will delegate.
     * @param to The identity that gets delegated. It can now sign messages as if it was the
     *           identity above.
     * @param expiration The length the delegation is valid. By default, 15 minutes from calling
     *                   this function.
     * @param options A set of options for this delegation. expiration and previous
     * @param options.previous - Another DelegationChain that this chain should start with.
     * @param options.targets - targets that scope the delegation (e.g. Canister Principals)
     */
    static async create(from, to, expiration = new Date(Date.now() + 15 * 60 * 1e3), options = {}) {
      var _a2, _b2;
      const delegation = await _createSingleDelegation(from, to, expiration, options.targets);
      return new _DelegationChain([...((_a2 = options.previous) === null || _a2 === void 0 ? void 0 : _a2.delegations) || [], delegation], ((_b2 = options.previous) === null || _b2 === void 0 ? void 0 : _b2.publicKey) || from.getPublicKey().toDer());
    }
    /**
     * Creates a DelegationChain object from a JSON string.
     * @param json The JSON string to parse.
     */
    static fromJSON(json) {
      const { publicKey, delegations } = typeof json === "string" ? JSON.parse(json) : json;
      if (!Array.isArray(delegations)) {
        throw new Error("Invalid delegations.");
      }
      const parsedDelegations = delegations.map((signedDelegation) => {
        const { delegation, signature } = signedDelegation;
        const { pubkey, expiration, targets } = delegation;
        if (targets !== void 0 && !Array.isArray(targets)) {
          throw new Error("Invalid targets.");
        }
        return {
          delegation: new Delegation(
            _parseBlob(pubkey),
            BigInt("0x" + expiration),
            // expiration in JSON is an hexa string (See toJSON() below).
            targets && targets.map((t2) => {
              if (typeof t2 !== "string") {
                throw new Error("Invalid target.");
              }
              return Principal.fromHex(t2);
            })
          ),
          signature: _parseBlob(signature)
        };
      });
      return new this(parsedDelegations, _parseBlob(publicKey));
    }
    /**
     * Creates a DelegationChain object from a list of delegations and a DER-encoded public key.
     * @param delegations The list of delegations.
     * @param publicKey The DER-encoded public key of the key-pair signing the first delegation.
     */
    static fromDelegations(delegations, publicKey) {
      return new this(delegations, publicKey);
    }
    toJSON() {
      return {
        delegations: this.delegations.map((signedDelegation) => {
          const { delegation, signature } = signedDelegation;
          const { targets } = delegation;
          return {
            delegation: Object.assign({ expiration: delegation.expiration.toString(16), pubkey: toHex(delegation.pubkey) }, targets && {
              targets: targets.map((t2) => t2.toHex())
            }),
            signature: toHex(signature)
          };
        }),
        publicKey: toHex(this.publicKey)
      };
    }
  };
  var DelegationIdentity = class extends SignIdentity {
    constructor(_inner, _delegation) {
      super();
      this._inner = _inner;
      this._delegation = _delegation;
    }
    /**
     * Create a delegation without having access to delegateKey.
     * @param key The key used to sign the requests.
     * @param delegation A delegation object created using `createDelegation`.
     */
    static fromDelegation(key, delegation) {
      return new this(key, delegation);
    }
    getDelegation() {
      return this._delegation;
    }
    getPublicKey() {
      return {
        derKey: this._delegation.publicKey,
        toDer: () => this._delegation.publicKey
      };
    }
    sign(blob) {
      return this._inner.sign(blob);
    }
    async transformRequest(request2) {
      const { body } = request2, fields = __rest2(request2, ["body"]);
      const requestId = await requestIdOf(body);
      return Object.assign(Object.assign({}, fields), { body: {
        content: body,
        sender_sig: await this.sign(new Uint8Array([...requestDomainSeparator, ...new Uint8Array(requestId)])),
        sender_delegation: this._delegation.delegations,
        sender_pubkey: this._delegation.publicKey
      } });
    }
  };
  var PartialDelegationIdentity = class _PartialDelegationIdentity extends PartialIdentity {
    constructor(inner, delegation) {
      super(inner);
      _PartialDelegationIdentity_delegation.set(this, void 0);
      __classPrivateFieldSet7(this, _PartialDelegationIdentity_delegation, delegation, "f");
    }
    /**
     * The Delegation Chain of this identity.
     */
    get delegation() {
      return __classPrivateFieldGet7(this, _PartialDelegationIdentity_delegation, "f");
    }
    /**
     * Create a {@link PartialDelegationIdentity} from a {@link PublicKey} and a {@link DelegationChain}.
     * @param key The {@link PublicKey} to delegate to.
     * @param delegation a {@link DelegationChain} targeting the inner key.
     * @constructs PartialDelegationIdentity
     */
    static fromDelegation(key, delegation) {
      return new _PartialDelegationIdentity(key, delegation);
    }
  };
  _PartialDelegationIdentity_delegation = /* @__PURE__ */ new WeakMap();
  function isDelegationValid(chain2, checks) {
    for (const { delegation } of chain2.delegations) {
      if (+new Date(Number(delegation.expiration / BigInt(1e6))) <= +Date.now()) {
        return false;
      }
    }
    const scopes = [];
    const maybeScope = checks === null || checks === void 0 ? void 0 : checks.scope;
    if (maybeScope) {
      if (Array.isArray(maybeScope)) {
        scopes.push(...maybeScope.map((s2) => typeof s2 === "string" ? Principal.fromText(s2) : s2));
      } else {
        scopes.push(typeof maybeScope === "string" ? Principal.fromText(maybeScope) : maybeScope);
      }
    }
    for (const s2 of scopes) {
      const scope = s2.toText();
      for (const { delegation } of chain2.delegations) {
        if (delegation.targets === void 0) {
          continue;
        }
        let none = true;
        for (const target of delegation.targets) {
          if (target.toText() === scope) {
            none = false;
            break;
          }
        }
        if (none) {
          return false;
        }
      }
    }
    return true;
  }

  // node_modules/@dfinity/identity/lib/esm/identity/webauthn.js
  var import_borc3 = __toESM(require_src());
  init_esm2();
  var PubKeyCoseAlgo;
  (function(PubKeyCoseAlgo2) {
    PubKeyCoseAlgo2[PubKeyCoseAlgo2["ECDSA_WITH_SHA256"] = -7] = "ECDSA_WITH_SHA256";
  })(PubKeyCoseAlgo || (PubKeyCoseAlgo = {}));

  // node_modules/@dfinity/auth-client/lib/esm/idleManager.js
  var events = ["mousedown", "mousemove", "keydown", "touchstart", "wheel"];
  var IdleManager = class {
    /**
     * @protected
     * @param options {@link IdleManagerOptions}
     */
    constructor(options = {}) {
      var _a2;
      this.callbacks = [];
      this.idleTimeout = 10 * 60 * 1e3;
      this.timeoutID = void 0;
      const { onIdle, idleTimeout = 10 * 60 * 1e3 } = options || {};
      this.callbacks = onIdle ? [onIdle] : [];
      this.idleTimeout = idleTimeout;
      const _resetTimer = this._resetTimer.bind(this);
      window.addEventListener("load", _resetTimer, true);
      events.forEach(function(name) {
        document.addEventListener(name, _resetTimer, true);
      });
      const debounce = (func, wait) => {
        let timeout2;
        return (...args) => {
          const context = this;
          const later = function() {
            timeout2 = void 0;
            func.apply(context, args);
          };
          clearTimeout(timeout2);
          timeout2 = window.setTimeout(later, wait);
        };
      };
      if (options === null || options === void 0 ? void 0 : options.captureScroll) {
        const scroll = debounce(_resetTimer, (_a2 = options === null || options === void 0 ? void 0 : options.scrollDebounce) !== null && _a2 !== void 0 ? _a2 : 100);
        window.addEventListener("scroll", scroll, true);
      }
      _resetTimer();
    }
    /**
     * Creates an {@link IdleManager}
     * @param {IdleManagerOptions} options Optional configuration
     * @see {@link IdleManagerOptions}
     * @param options.onIdle Callback once user has been idle. Use to prompt for fresh login, and use `Actor.agentOf(your_actor).invalidateIdentity()` to protect the user
     * @param options.idleTimeout timeout in ms
     * @param options.captureScroll capture scroll events
     * @param options.scrollDebounce scroll debounce time in ms
     */
    static create(options = {}) {
      return new this(options);
    }
    /**
     * @param {IdleCB} callback function to be called when user goes idle
     */
    registerCallback(callback) {
      this.callbacks.push(callback);
    }
    /**
     * Cleans up the idle manager and its listeners
     */
    exit() {
      clearTimeout(this.timeoutID);
      window.removeEventListener("load", this._resetTimer, true);
      const _resetTimer = this._resetTimer.bind(this);
      events.forEach(function(name) {
        document.removeEventListener(name, _resetTimer, true);
      });
      this.callbacks.forEach((cb) => cb());
    }
    /**
     * Resets the timeouts during cleanup
     */
    _resetTimer() {
      const exit = this.exit.bind(this);
      window.clearTimeout(this.timeoutID);
      this.timeoutID = window.setTimeout(exit, this.idleTimeout);
    }
  };

  // node_modules/idb/build/wrap-idb-value.js
  var instanceOfAny = (object, constructors) => constructors.some((c3) => object instanceof c3);
  var idbProxyableTypes;
  var cursorAdvanceMethods;
  function getIdbProxyableTypes() {
    return idbProxyableTypes || (idbProxyableTypes = [
      IDBDatabase,
      IDBObjectStore,
      IDBIndex,
      IDBCursor,
      IDBTransaction
    ]);
  }
  function getCursorAdvanceMethods() {
    return cursorAdvanceMethods || (cursorAdvanceMethods = [
      IDBCursor.prototype.advance,
      IDBCursor.prototype.continue,
      IDBCursor.prototype.continuePrimaryKey
    ]);
  }
  var cursorRequestMap = /* @__PURE__ */ new WeakMap();
  var transactionDoneMap = /* @__PURE__ */ new WeakMap();
  var transactionStoreNamesMap = /* @__PURE__ */ new WeakMap();
  var transformCache = /* @__PURE__ */ new WeakMap();
  var reverseTransformCache = /* @__PURE__ */ new WeakMap();
  function promisifyRequest(request2) {
    const promise = new Promise((resolve, reject) => {
      const unlisten = () => {
        request2.removeEventListener("success", success);
        request2.removeEventListener("error", error);
      };
      const success = () => {
        resolve(wrap(request2.result));
        unlisten();
      };
      const error = () => {
        reject(request2.error);
        unlisten();
      };
      request2.addEventListener("success", success);
      request2.addEventListener("error", error);
    });
    promise.then((value4) => {
      if (value4 instanceof IDBCursor) {
        cursorRequestMap.set(value4, request2);
      }
    }).catch(() => {
    });
    reverseTransformCache.set(promise, request2);
    return promise;
  }
  function cacheDonePromiseForTransaction(tx) {
    if (transactionDoneMap.has(tx))
      return;
    const done = new Promise((resolve, reject) => {
      const unlisten = () => {
        tx.removeEventListener("complete", complete);
        tx.removeEventListener("error", error);
        tx.removeEventListener("abort", error);
      };
      const complete = () => {
        resolve();
        unlisten();
      };
      const error = () => {
        reject(tx.error || new DOMException("AbortError", "AbortError"));
        unlisten();
      };
      tx.addEventListener("complete", complete);
      tx.addEventListener("error", error);
      tx.addEventListener("abort", error);
    });
    transactionDoneMap.set(tx, done);
  }
  var idbProxyTraps = {
    get(target, prop, receiver) {
      if (target instanceof IDBTransaction) {
        if (prop === "done")
          return transactionDoneMap.get(target);
        if (prop === "objectStoreNames") {
          return target.objectStoreNames || transactionStoreNamesMap.get(target);
        }
        if (prop === "store") {
          return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
        }
      }
      return wrap(target[prop]);
    },
    set(target, prop, value4) {
      target[prop] = value4;
      return true;
    },
    has(target, prop) {
      if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
        return true;
      }
      return prop in target;
    }
  };
  function replaceTraps(callback) {
    idbProxyTraps = callback(idbProxyTraps);
  }
  function wrapFunction(func) {
    if (func === IDBDatabase.prototype.transaction && !("objectStoreNames" in IDBTransaction.prototype)) {
      return function(storeNames, ...args) {
        const tx = func.call(unwrap(this), storeNames, ...args);
        transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
        return wrap(tx);
      };
    }
    if (getCursorAdvanceMethods().includes(func)) {
      return function(...args) {
        func.apply(unwrap(this), args);
        return wrap(cursorRequestMap.get(this));
      };
    }
    return function(...args) {
      return wrap(func.apply(unwrap(this), args));
    };
  }
  function transformCachableValue(value4) {
    if (typeof value4 === "function")
      return wrapFunction(value4);
    if (value4 instanceof IDBTransaction)
      cacheDonePromiseForTransaction(value4);
    if (instanceOfAny(value4, getIdbProxyableTypes()))
      return new Proxy(value4, idbProxyTraps);
    return value4;
  }
  function wrap(value4) {
    if (value4 instanceof IDBRequest)
      return promisifyRequest(value4);
    if (transformCache.has(value4))
      return transformCache.get(value4);
    const newValue = transformCachableValue(value4);
    if (newValue !== value4) {
      transformCache.set(value4, newValue);
      reverseTransformCache.set(newValue, value4);
    }
    return newValue;
  }
  var unwrap = (value4) => reverseTransformCache.get(value4);

  // node_modules/idb/build/index.js
  function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
    const request2 = indexedDB.open(name, version);
    const openPromise = wrap(request2);
    if (upgrade) {
      request2.addEventListener("upgradeneeded", (event) => {
        upgrade(wrap(request2.result), event.oldVersion, event.newVersion, wrap(request2.transaction), event);
      });
    }
    if (blocked) {
      request2.addEventListener("blocked", (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion,
        event.newVersion,
        event
      ));
    }
    openPromise.then((db) => {
      if (terminated)
        db.addEventListener("close", () => terminated());
      if (blocking) {
        db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
      }
    }).catch(() => {
    });
    return openPromise;
  }
  var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
  var writeMethods = ["put", "add", "delete", "clear"];
  var cachedMethods = /* @__PURE__ */ new Map();
  function getMethod(target, prop) {
    if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
      return;
    }
    if (cachedMethods.get(prop))
      return cachedMethods.get(prop);
    const targetFuncName = prop.replace(/FromIndex$/, "");
    const useIndex = prop !== targetFuncName;
    const isWrite = writeMethods.includes(targetFuncName);
    if (
      // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
      !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
    ) {
      return;
    }
    const method = async function(storeName, ...args) {
      const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
      let target2 = tx.store;
      if (useIndex)
        target2 = target2.index(args.shift());
      return (await Promise.all([
        target2[targetFuncName](...args),
        isWrite && tx.done
      ]))[0];
    };
    cachedMethods.set(prop, method);
    return method;
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
    has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
  }));

  // node_modules/@dfinity/auth-client/lib/esm/db.js
  var AUTH_DB_NAME = "auth-client-db";
  var OBJECT_STORE_NAME = "ic-keyval";
  var _openDbStore = async (dbName = AUTH_DB_NAME, storeName = OBJECT_STORE_NAME, version) => {
    if (isBrowser && (localStorage === null || localStorage === void 0 ? void 0 : localStorage.getItem(KEY_STORAGE_DELEGATION))) {
      localStorage.removeItem(KEY_STORAGE_DELEGATION);
      localStorage.removeItem(KEY_STORAGE_KEY);
    }
    return await openDB(dbName, version, {
      upgrade: (database) => {
        if (database.objectStoreNames.contains(storeName)) {
          database.clear(storeName);
        }
        database.createObjectStore(storeName);
      }
    });
  };
  async function _getValue(db, storeName, key) {
    return await db.get(storeName, key);
  }
  async function _setValue(db, storeName, key, value4) {
    return await db.put(storeName, value4, key);
  }
  async function _removeValue(db, storeName, key) {
    return await db.delete(storeName, key);
  }
  var IdbKeyVal = class _IdbKeyVal {
    // Do not use - instead prefer create
    constructor(_db, _storeName) {
      this._db = _db;
      this._storeName = _storeName;
    }
    /**
     * @param {DBCreateOptions} options - DBCreateOptions
     * @param {DBCreateOptions['dbName']} options.dbName name for the indexeddb database
     * @default
     * @param {DBCreateOptions['storeName']} options.storeName name for the indexeddb Data Store
     * @default
     * @param {DBCreateOptions['version']} options.version version of the database. Increment to safely upgrade
     * @constructs an {@link IdbKeyVal}
     */
    static async create(options) {
      const { dbName = AUTH_DB_NAME, storeName = OBJECT_STORE_NAME, version = DB_VERSION } = options !== null && options !== void 0 ? options : {};
      const db = await _openDbStore(dbName, storeName, version);
      return new _IdbKeyVal(db, storeName);
    }
    /**
     * Basic setter
     * @param {IDBValidKey} key string | number | Date | BufferSource | IDBValidKey[]
     * @param value value to set
     * @returns void
     */
    async set(key, value4) {
      return await _setValue(this._db, this._storeName, key, value4);
    }
    /**
     * Basic getter
     * Pass in a type T for type safety if you know the type the value will have if it is found
     * @param {IDBValidKey} key string | number | Date | BufferSource | IDBValidKey[]
     * @returns `Promise<T | null>`
     * @example
     * await get<string>('exampleKey') -> 'exampleValue'
     */
    async get(key) {
      var _a2;
      return (_a2 = await _getValue(this._db, this._storeName, key)) !== null && _a2 !== void 0 ? _a2 : null;
    }
    /**
     * Remove a key
     * @param key {@link IDBValidKey}
     * @returns void
     */
    async remove(key) {
      return await _removeValue(this._db, this._storeName, key);
    }
  };

  // node_modules/@dfinity/auth-client/lib/esm/storage.js
  var __classPrivateFieldSet8 = function(receiver, state, value4, kind, f4) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f4.call(receiver, value4) : f4 ? f4.value = value4 : state.set(receiver, value4), value4;
  };
  var __classPrivateFieldGet8 = function(receiver, state, kind, f4) {
    if (kind === "a" && !f4)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f4 : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f4 : kind === "a" ? f4.call(receiver) : f4 ? f4.value : state.get(receiver);
  };
  var _IdbStorage_options;
  var KEY_STORAGE_KEY = "identity";
  var KEY_STORAGE_DELEGATION = "delegation";
  var KEY_VECTOR = "iv";
  var DB_VERSION = 1;
  var isBrowser = typeof window !== "undefined";
  var LocalStorage = class {
    constructor(prefix = "ic-", _localStorage) {
      this.prefix = prefix;
      this._localStorage = _localStorage;
    }
    get(key) {
      return Promise.resolve(this._getLocalStorage().getItem(this.prefix + key));
    }
    set(key, value4) {
      this._getLocalStorage().setItem(this.prefix + key, value4);
      return Promise.resolve();
    }
    remove(key) {
      this._getLocalStorage().removeItem(this.prefix + key);
      return Promise.resolve();
    }
    _getLocalStorage() {
      if (this._localStorage) {
        return this._localStorage;
      }
      const ls = typeof window === "undefined" ? typeof window === "undefined" ? typeof self === "undefined" ? void 0 : self.localStorage : window.localStorage : window.localStorage;
      if (!ls) {
        throw new Error("Could not find local storage.");
      }
      return ls;
    }
  };
  var IdbStorage = class {
    /**
     * @param options - DBCreateOptions
     * @param options.dbName - name for the indexeddb database
     * @param options.storeName - name for the indexeddb Data Store
     * @param options.version - version of the database. Increment to safely upgrade
     * @constructs an {@link IdbStorage}
     * @example
     * ```typescript
     * const storage = new IdbStorage({ dbName: 'my-db', storeName: 'my-store', version: 2 });
     * ```
     */
    constructor(options) {
      _IdbStorage_options.set(this, void 0);
      __classPrivateFieldSet8(this, _IdbStorage_options, options !== null && options !== void 0 ? options : {}, "f");
    }
    get _db() {
      return new Promise((resolve) => {
        if (this.initializedDb) {
          resolve(this.initializedDb);
          return;
        }
        IdbKeyVal.create(__classPrivateFieldGet8(this, _IdbStorage_options, "f")).then((db) => {
          this.initializedDb = db;
          resolve(db);
        });
      });
    }
    async get(key) {
      const db = await this._db;
      return await db.get(key);
    }
    async set(key, value4) {
      const db = await this._db;
      await db.set(key, value4);
    }
    async remove(key) {
      const db = await this._db;
      await db.remove(key);
    }
  };
  _IdbStorage_options = /* @__PURE__ */ new WeakMap();

  // node_modules/@dfinity/auth-client/lib/esm/index.js
  var IDENTITY_PROVIDER_DEFAULT = "https://identity.ic0.app";
  var IDENTITY_PROVIDER_ENDPOINT = "#authorize";
  var ECDSA_KEY_LABEL = "ECDSA";
  var ED25519_KEY_LABEL = "Ed25519";
  var INTERRUPT_CHECK_INTERVAL = 500;
  var ERROR_USER_INTERRUPT = "UserInterrupt";
  var AuthClient = class {
    constructor(_identity, _key, _chain, _storage, idleManager, _createOptions, _idpWindow, _eventHandler) {
      this._identity = _identity;
      this._key = _key;
      this._chain = _chain;
      this._storage = _storage;
      this.idleManager = idleManager;
      this._createOptions = _createOptions;
      this._idpWindow = _idpWindow;
      this._eventHandler = _eventHandler;
      this._registerDefaultIdleCallback();
    }
    /**
     * Create an AuthClient to manage authentication and identity
     * @constructs
     * @param {AuthClientCreateOptions} options - Options for creating an {@link AuthClient}
     * @see {@link AuthClientCreateOptions}
     * @param options.identity Optional Identity to use as the base
     * @see {@link SignIdentity}
     * @param options.storage Storage mechanism for delegration credentials
     * @see {@link AuthClientStorage}
     * @param options.keyType Type of key to use for the base key
     * @param {IdleOptions} options.idleOptions Configures an {@link IdleManager}
     * @see {@link IdleOptions}
     * Default behavior is to clear stored identity and reload the page when a user goes idle, unless you set the disableDefaultIdleCallback flag or pass in a custom idle callback.
     * @example
     * const authClient = await AuthClient.create({
     *   idleOptions: {
     *     disableIdle: true
     *   }
     * })
     */
    static async create(options = {}) {
      var _a2, _b2, _c;
      const storage = (_a2 = options.storage) !== null && _a2 !== void 0 ? _a2 : new IdbStorage();
      const keyType = (_b2 = options.keyType) !== null && _b2 !== void 0 ? _b2 : ECDSA_KEY_LABEL;
      let key = null;
      if (options.identity) {
        key = options.identity;
      } else {
        let maybeIdentityStorage = await storage.get(KEY_STORAGE_KEY);
        if (!maybeIdentityStorage && isBrowser) {
          try {
            const fallbackLocalStorage = new LocalStorage();
            const localChain = await fallbackLocalStorage.get(KEY_STORAGE_DELEGATION);
            const localKey = await fallbackLocalStorage.get(KEY_STORAGE_KEY);
            if (localChain && localKey && keyType === ECDSA_KEY_LABEL) {
              console.log("Discovered an identity stored in localstorage. Migrating to IndexedDB");
              await storage.set(KEY_STORAGE_DELEGATION, localChain);
              await storage.set(KEY_STORAGE_KEY, localKey);
              maybeIdentityStorage = localChain;
              await fallbackLocalStorage.remove(KEY_STORAGE_DELEGATION);
              await fallbackLocalStorage.remove(KEY_STORAGE_KEY);
            }
          } catch (error) {
            console.error("error while attempting to recover localstorage: " + error);
          }
        }
        if (maybeIdentityStorage) {
          try {
            if (typeof maybeIdentityStorage === "object") {
              if (keyType === ED25519_KEY_LABEL && typeof maybeIdentityStorage === "string") {
                key = await Ed25519KeyIdentity.fromJSON(maybeIdentityStorage);
              } else {
                key = await ECDSAKeyIdentity.fromKeyPair(maybeIdentityStorage);
              }
            } else if (typeof maybeIdentityStorage === "string") {
              key = Ed25519KeyIdentity.fromJSON(maybeIdentityStorage);
            }
          } catch (_d) {
          }
        }
      }
      let identity = new AnonymousIdentity();
      let chain2 = null;
      if (key) {
        try {
          const chainStorage = await storage.get(KEY_STORAGE_DELEGATION);
          if (typeof chainStorage === "object" && chainStorage !== null) {
            throw new Error("Delegation chain is incorrectly stored. A delegation chain should be stored as a string.");
          }
          if (options.identity) {
            identity = options.identity;
          } else if (chainStorage) {
            chain2 = DelegationChain.fromJSON(chainStorage);
            if (!isDelegationValid(chain2)) {
              await _deleteStorage(storage);
              key = null;
            } else {
              if ("toDer" in key) {
                identity = PartialDelegationIdentity.fromDelegation(key, chain2);
              } else {
                identity = DelegationIdentity.fromDelegation(key, chain2);
              }
            }
          }
        } catch (e3) {
          console.error(e3);
          await _deleteStorage(storage);
          key = null;
        }
      }
      let idleManager = void 0;
      if ((_c = options.idleOptions) === null || _c === void 0 ? void 0 : _c.disableIdle) {
        idleManager = void 0;
      } else if (chain2 || options.identity) {
        idleManager = IdleManager.create(options.idleOptions);
      }
      if (!key) {
        if (keyType === ED25519_KEY_LABEL) {
          key = await Ed25519KeyIdentity.generate();
          await storage.set(KEY_STORAGE_KEY, JSON.stringify(key.toJSON()));
        } else {
          if (options.storage && keyType === ECDSA_KEY_LABEL) {
            console.warn(`You are using a custom storage provider that may not support CryptoKey storage. If you are using a custom storage provider that does not support CryptoKey storage, you should use '${ED25519_KEY_LABEL}' as the key type, as it can serialize to a string`);
          }
          key = await ECDSAKeyIdentity.generate();
          await storage.set(KEY_STORAGE_KEY, key.getKeyPair());
        }
      }
      return new this(identity, key, chain2, storage, idleManager, options);
    }
    _registerDefaultIdleCallback() {
      var _a2, _b2;
      const idleOptions = (_a2 = this._createOptions) === null || _a2 === void 0 ? void 0 : _a2.idleOptions;
      if (!(idleOptions === null || idleOptions === void 0 ? void 0 : idleOptions.onIdle) && !(idleOptions === null || idleOptions === void 0 ? void 0 : idleOptions.disableDefaultIdleCallback)) {
        (_b2 = this.idleManager) === null || _b2 === void 0 ? void 0 : _b2.registerCallback(() => {
          this.logout();
          location.reload();
        });
      }
    }
    async _handleSuccess(message, onSuccess) {
      var _a2, _b2;
      const delegations = message.delegations.map((signedDelegation) => {
        return {
          delegation: new Delegation(signedDelegation.delegation.pubkey, signedDelegation.delegation.expiration, signedDelegation.delegation.targets),
          signature: signedDelegation.signature.buffer
        };
      });
      const delegationChain = DelegationChain.fromDelegations(delegations, message.userPublicKey.buffer);
      const key = this._key;
      if (!key) {
        return;
      }
      this._chain = delegationChain;
      if ("toDer" in key) {
        this._identity = PartialDelegationIdentity.fromDelegation(key, this._chain);
      } else {
        this._identity = DelegationIdentity.fromDelegation(key, this._chain);
      }
      (_a2 = this._idpWindow) === null || _a2 === void 0 ? void 0 : _a2.close();
      const idleOptions = (_b2 = this._createOptions) === null || _b2 === void 0 ? void 0 : _b2.idleOptions;
      if (!this.idleManager && !(idleOptions === null || idleOptions === void 0 ? void 0 : idleOptions.disableIdle)) {
        this.idleManager = IdleManager.create(idleOptions);
        this._registerDefaultIdleCallback();
      }
      this._removeEventListener();
      delete this._idpWindow;
      if (this._chain) {
        await this._storage.set(KEY_STORAGE_DELEGATION, JSON.stringify(this._chain.toJSON()));
      }
      onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess(message);
    }
    getIdentity() {
      return this._identity;
    }
    async isAuthenticated() {
      return !this.getIdentity().getPrincipal().isAnonymous() && this._chain !== null;
    }
    /**
     * AuthClient Login -
     * Opens up a new window to authenticate with Internet Identity
     * @param {AuthClientLoginOptions} options - Options for logging in
     * @param options.identityProvider Identity provider
     * @param options.maxTimeToLive Expiration of the authentication in nanoseconds
     * @param options.allowPinAuthentication If present, indicates whether or not the Identity Provider should allow the user to authenticate and/or register using a temporary key/PIN identity. Authenticating dapps may want to prevent users from using Temporary keys/PIN identities because Temporary keys/PIN identities are less secure than Passkeys (webauthn credentials) and because Temporary keys/PIN identities generally only live in a browser database (which may get cleared by the browser/OS).
     * @param options.derivationOrigin Origin for Identity Provider to use while generating the delegated identity
     * @param options.windowOpenerFeatures Configures the opened authentication window
     * @param options.onSuccess Callback once login has completed
     * @param options.onError Callback in case authentication fails
     * @example
     * const authClient = await AuthClient.create();
     * authClient.login({
     *  identityProvider: 'http://<canisterID>.127.0.0.1:8000',
     *  maxTimeToLive: BigInt (7) * BigInt(24) * BigInt(3_600_000_000_000), // 1 week
     *  windowOpenerFeatures: "toolbar=0,location=0,menubar=0,width=500,height=500,left=100,top=100",
     *  onSuccess: () => {
     *    console.log('Login Successful!');
     *  },
     *  onError: (error) => {
     *    console.error('Login Failed: ', error);
     *  }
     * });
     */
    async login(options) {
      var _a2, _b2, _c, _d;
      const defaultTimeToLive = (
        /* hours */
        BigInt(8) * /* nanoseconds */
        BigInt(36e11)
      );
      const identityProviderUrl = new URL(((_a2 = options === null || options === void 0 ? void 0 : options.identityProvider) === null || _a2 === void 0 ? void 0 : _a2.toString()) || IDENTITY_PROVIDER_DEFAULT);
      identityProviderUrl.hash = IDENTITY_PROVIDER_ENDPOINT;
      (_b2 = this._idpWindow) === null || _b2 === void 0 ? void 0 : _b2.close();
      this._removeEventListener();
      this._eventHandler = this._getEventHandler(identityProviderUrl, Object.assign({ maxTimeToLive: (_c = options === null || options === void 0 ? void 0 : options.maxTimeToLive) !== null && _c !== void 0 ? _c : defaultTimeToLive }, options));
      window.addEventListener("message", this._eventHandler);
      this._idpWindow = (_d = window.open(identityProviderUrl.toString(), "idpWindow", options === null || options === void 0 ? void 0 : options.windowOpenerFeatures)) !== null && _d !== void 0 ? _d : void 0;
      const checkInterruption = () => {
        if (this._idpWindow) {
          if (this._idpWindow.closed) {
            this._handleFailure(ERROR_USER_INTERRUPT, options === null || options === void 0 ? void 0 : options.onError);
          } else {
            setTimeout(checkInterruption, INTERRUPT_CHECK_INTERVAL);
          }
        }
      };
      checkInterruption();
    }
    _getEventHandler(identityProviderUrl, options) {
      return async (event) => {
        var _a2, _b2, _c;
        if (event.origin !== identityProviderUrl.origin) {
          return;
        }
        const message = event.data;
        switch (message.kind) {
          case "authorize-ready": {
            const request2 = Object.assign({ kind: "authorize-client", sessionPublicKey: new Uint8Array((_a2 = this._key) === null || _a2 === void 0 ? void 0 : _a2.getPublicKey().toDer()), maxTimeToLive: options === null || options === void 0 ? void 0 : options.maxTimeToLive, allowPinAuthentication: options === null || options === void 0 ? void 0 : options.allowPinAuthentication, derivationOrigin: (_b2 = options === null || options === void 0 ? void 0 : options.derivationOrigin) === null || _b2 === void 0 ? void 0 : _b2.toString() }, options === null || options === void 0 ? void 0 : options.customValues);
            (_c = this._idpWindow) === null || _c === void 0 ? void 0 : _c.postMessage(request2, identityProviderUrl.origin);
            break;
          }
          case "authorize-client-success":
            try {
              await this._handleSuccess(message, options === null || options === void 0 ? void 0 : options.onSuccess);
            } catch (err) {
              this._handleFailure(err.message, options === null || options === void 0 ? void 0 : options.onError);
            }
            break;
          case "authorize-client-failure":
            this._handleFailure(message.text, options === null || options === void 0 ? void 0 : options.onError);
            break;
          default:
            break;
        }
      };
    }
    _handleFailure(errorMessage, onError) {
      var _a2;
      (_a2 = this._idpWindow) === null || _a2 === void 0 ? void 0 : _a2.close();
      onError === null || onError === void 0 ? void 0 : onError(errorMessage);
      this._removeEventListener();
      delete this._idpWindow;
    }
    _removeEventListener() {
      if (this._eventHandler) {
        window.removeEventListener("message", this._eventHandler);
      }
      this._eventHandler = void 0;
    }
    async logout(options = {}) {
      await _deleteStorage(this._storage);
      this._identity = new AnonymousIdentity();
      this._chain = null;
      if (options.returnTo) {
        try {
          window.history.pushState({}, "", options.returnTo);
        } catch (_a2) {
          window.location.href = options.returnTo;
        }
      }
    }
  };
  async function _deleteStorage(storage) {
    await storage.remove(KEY_STORAGE_KEY);
    await storage.remove(KEY_STORAGE_DELEGATION);
    await storage.remove(KEY_VECTOR);
  }

  // src/index.ts
  var createAuthClient = () => AuthClient.create({
    idleOptions: {
      disableIdle: true,
      disableDefaultIdleCallback: true
    }
  });
  var addControllerToNeuron = async (canisterId, neuronIdHex, principal) => {
    const authClient = await createAuthClient();
    const agent = new HttpAgent({
      host: "https://icp-api.io",
      identity: authClient.getIdentity()
    });
    const governance = Qt.create({
      canisterId: Principal.fromText(canisterId),
      agent
    });
    const neuronId = { id: At(neuronIdHex) };
    await governance.addNeuronPermissions({
      neuronId,
      permissions: [
        Ct3.NEURON_PERMISSION_TYPE_UNSPECIFIED,
        Ct3.NEURON_PERMISSION_TYPE_CONFIGURE_DISSOLVE_STATE,
        Ct3.NEURON_PERMISSION_TYPE_MANAGE_PRINCIPALS,
        Ct3.NEURON_PERMISSION_TYPE_SUBMIT_PROPOSAL,
        Ct3.NEURON_PERMISSION_TYPE_VOTE,
        Ct3.NEURON_PERMISSION_TYPE_DISBURSE,
        Ct3.NEURON_PERMISSION_TYPE_SPLIT,
        Ct3.NEURON_PERMISSION_TYPE_MERGE_MATURITY,
        Ct3.NEURON_PERMISSION_TYPE_DISBURSE_MATURITY,
        Ct3.NEURON_PERMISSION_TYPE_STAKE_MATURITY,
        Ct3.NEURON_PERMISSION_TYPE_MANAGE_VOTING_PERMISSION      
      ],
      principal: Principal.fromText(principal)
    });
    return governance;
  };
  return __toCommonJS(src_exports);
})();
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

@noble/curves/esm/abstract/utils.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/modular.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/curve.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/weierstrass.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/bls.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/tower.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/bls12-381.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/edwards.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@dfinity/sns/dist/esm/chunk-Q55ZUKOX.js:
  (*! Bundled license information:
  
  @noble/hashes/esm/utils.js:
    (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
  *)
*/

// Add a controller to a specific neuron
await yolosns.addControllerToNeuron(
  "fi3zi-fyaaa-aaaaq-aachq-cai",  // SNS governance canister ID
  "b4ad135e433eee2fa0ee3f9dccf65fd8b8721fc58a9357235e560cdc4cc4f98c",           // Your neuron ID as a hex string
  "lcyf6-t6uno-og7on-w4fyq-tegjt-ejrcg-kyaio-wcvvm-yu3vo-h2nbl-jqe"     // Principal to add as controller
)