var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var _hasDate, _hasTime, _offset;
import { app, ipcMain, dialog, shell, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { spawn, exec } from "child_process";
import fs from "fs";
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
class TomlError extends Error {
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    __publicField(this, "line");
    __publicField(this, "column");
    __publicField(this, "codeblock");
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function isEscaped(str, ptr) {
  let i = 0;
  while (str[ptr - ++i] === "\\")
    ;
  return --i && i % 2;
}
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf("\n", start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "\n")
      return i;
    if (c === "\r" && str[i + 1] === "\n")
      return i + 1;
    if (c < " " && c !== "	" || c === "") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while ((c = str[ptr]) === " " || c === "	" || !banNewLines && (c === "\n" || c === "\r" && str[ptr + 1] === "\n"))
    ptr++;
  return banComments || c !== "#" ? ptr : skipVoid(str, skipComment(str, ptr), banNewLines);
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === "\n" || c === "\r" && str[i + 1] === "\n")) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}
function getStringEnd(str, seek) {
  let first = str[seek];
  let target = first === str[seek + 1] && str[seek + 1] === str[seek + 2] ? str.slice(seek, seek + 3) : first;
  seek += target.length - 1;
  do
    seek = str.indexOf(target, ++seek);
  while (seek > -1 && first !== "'" && isEscaped(str, seek));
  if (seek > -1) {
    seek += target.length;
    if (target.length > 1) {
      if (str[seek] === first)
        seek++;
      if (str[seek] === first)
        seek++;
    }
  }
  return seek;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
let DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
const _TomlDate = class _TomlDate extends Date {
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    __privateAdd(this, _hasDate, false);
    __privateAdd(this, _hasTime, false);
    __privateAdd(this, _offset, null);
    if (!isNaN(this.getTime())) {
      __privateSet(this, _hasDate, hasDate);
      __privateSet(this, _hasTime, hasTime);
      __privateSet(this, _offset, offset);
    }
  }
  isDateTime() {
    return __privateGet(this, _hasDate) && __privateGet(this, _hasTime);
  }
  isLocal() {
    return !__privateGet(this, _hasDate) || !__privateGet(this, _hasTime) || !__privateGet(this, _offset);
  }
  isDate() {
    return __privateGet(this, _hasDate) && !__privateGet(this, _hasTime);
  }
  isTime() {
    return __privateGet(this, _hasTime) && !__privateGet(this, _hasDate);
  }
  isValid() {
    return __privateGet(this, _hasDate) || __privateGet(this, _hasTime);
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (__privateGet(this, _offset) === null)
      return iso.slice(0, -1);
    if (__privateGet(this, _offset) === "Z")
      return iso;
    let offset = +__privateGet(this, _offset).slice(1, 3) * 60 + +__privateGet(this, _offset).slice(4, 6);
    offset = __privateGet(this, _offset)[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + __privateGet(this, _offset);
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    __privateSet(date, _offset, offset);
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    __privateSet(date, _offset, null);
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    __privateSet(date, _hasTime, false);
    __privateSet(date, _offset, null);
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    __privateSet(date, _hasDate, false);
    __privateSet(date, _offset, null);
    return date;
  }
};
_hasDate = new WeakMap();
_hasTime = new WeakMap();
_offset = new WeakMap();
let TomlDate = _TomlDate;
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
let INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
let FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
let LEADING_ZERO = /^[+-]?0[0-9_]/;
let ESCAPE_REGEX = /^[0-9a-f]{2,8}$/i;
let ESC_MAP = {
  b: "\b",
  t: "	",
  n: "\n",
  f: "\f",
  r: "\r",
  e: "\x1B",
  '"': '"',
  "\\": "\\"
};
function parseString(str, ptr = 0, endPtr = str.length) {
  let isLiteral = str[ptr] === "'";
  let isMultiline = str[ptr++] === str[ptr] && str[ptr] === str[ptr + 1];
  if (isMultiline) {
    endPtr -= 2;
    if (str[ptr += 2] === "\r")
      ptr++;
    if (str[ptr] === "\n")
      ptr++;
  }
  let tmp = 0;
  let isEscape;
  let parsed = "";
  let sliceStart = ptr;
  while (ptr < endPtr - 1) {
    let c = str[ptr++];
    if (c === "\n" || c === "\r" && str[ptr] === "\n") {
      if (!isMultiline) {
        throw new TomlError("newlines are not allowed in strings", {
          toml: str,
          ptr: ptr - 1
        });
      }
    } else if (c < " " && c !== "	" || c === "") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: ptr - 1
      });
    }
    if (isEscape) {
      isEscape = false;
      if (c === "x" || c === "u" || c === "U") {
        let code = str.slice(ptr, ptr += c === "x" ? 2 : c === "u" ? 4 : 8);
        if (!ESCAPE_REGEX.test(code)) {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
        try {
          parsed += String.fromCodePoint(parseInt(code, 16));
        } catch {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
      } else if (isMultiline && (c === "\n" || c === " " || c === "	" || c === "\r")) {
        ptr = skipVoid(str, ptr - 1, true);
        if (str[ptr] !== "\n" && str[ptr] !== "\r") {
          throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
            toml: str,
            ptr: tmp
          });
        }
        ptr = skipVoid(str, ptr);
      } else if (c in ESC_MAP) {
        parsed += ESC_MAP[c];
      } else {
        throw new TomlError("unrecognized escape sequence", {
          toml: str,
          ptr: tmp
        });
      }
      sliceStart = ptr;
    } else if (!isLiteral && c === "\\") {
      tmp = ptr - 1;
      isEscape = true;
      parsed += str.slice(sliceStart, tmp);
    }
  }
  return parsed + str.slice(sliceStart, endPtr - 1);
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function sliceAndTrimEndOf(str, startPtr, endPtr) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] === ",")
        endPtr2++;
      else if (str[endPtr2] !== end) {
        throw new TomlError("expected comma or end of structure", {
          toml: str,
          ptr: endPtr2
        });
      }
    }
    return [value, endPtr2];
  }
  let endPtr;
  if (c === '"' || c === "'") {
    endPtr = getStringEnd(str, ptr);
    let parsed = parseString(str, ptr, endPtr);
    if (end) {
      endPtr = skipVoid(str, endPtr);
      if (str[endPtr] && str[endPtr] !== "," && str[endPtr] !== end && str[endPtr] !== "\n" && str[endPtr] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr
        });
      }
      endPtr += +(str[endPtr] === ",");
    }
    return [parsed, endPtr];
  }
  endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - +(str[endPtr - 1] === ","));
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    endPtr += +(str[endPtr] === ",");
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
let KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "	") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let eos = getStringEnd(str, ptr);
        if (eos < 0) {
          throw new TomlError("unfinished string encountered", {
            toml: str,
            ptr
          });
        }
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(parseString(str, ptr, eos));
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0; i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
    }
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function peekTable(key, table, meta, type) {
  var _a, _b;
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && ((_a = m[k]) == null ? void 0 : _a.t) === 0 && ((_b = m[k]) == null ? void 0 : _b.d)) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0); ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(
        k[0],
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(
        k[0],
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], void 0, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== "\n" && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}
const require$1 = createRequire(import.meta.url);
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT_DIR = app.isPackaged ? path.dirname(process.resourcesPath) : path.resolve(__dirname$1, "../../..");
const LOG_DIR = path.join(APP_ROOT_DIR, "logs");
const APP_LOG_PATH = path.join(LOG_DIR, "app.log");
function setupLogging() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const logStream = fs.createWriteStream(APP_LOG_PATH, { flags: "a" });
    const originalLog = console.log;
    const originalError = console.error;
    const formatMessage = (args) => {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      return `[${timestamp}] ` + args.map(
        (arg) => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(" ") + "\n";
    };
    console.log = (...args) => {
      originalLog.apply(console, args);
      logStream.write(formatMessage(args));
    };
    console.error = (...args) => {
      originalError.apply(console, args);
      logStream.write(`[ERROR] ` + formatMessage(args));
    };
    console.log("=========================================");
    console.log(`App started at ${(/* @__PURE__ */ new Date()).toLocaleString()}`);
    console.log(`Version: ${app.getVersion()}`);
    console.log(`Platform: ${process.platform} (${process.arch})`);
    console.log(`Packaged: ${app.isPackaged}`);
    console.log("=========================================");
  } catch (e) {
    process.stderr.write(`Failed to setup logging: ${e}
`);
  }
}
setupLogging();
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception in main process:", error);
});
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
let activeBackendProcess = null;
let activeTensorboardProcess = null;
const SETTINGS_FILE = path.join(app.isPackaged ? path.dirname(process.resourcesPath) : path.resolve(__dirname$1, "../../.."), "settings.json");
const loadSettings = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return {};
};
const saveSettings = (settings) => {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
};
function createWindow() {
  console.log("createWindow called");
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      webSecurity: false
      // Allow loading local resources (file://)
    },
    autoHideMenuBar: true,
    // Hide the default menu bar (File, Edit, etc.)
    frame: false
    // Frameless window for custom title bar
  });
  console.log("BrowserWindow created, id:", win.id);
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  win.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: "deny" };
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.whenReady().then(() => {
  console.log("App is ready, creating window...");
  createWindow();
  ipcMain.on("window-minimize", () => {
    win == null ? void 0 : win.minimize();
  });
  ipcMain.on("window-toggle-maximize", () => {
    if (win == null ? void 0 : win.isMaximized()) {
      win.unmaximize();
    } else {
      win == null ? void 0 : win.maximize();
    }
  });
  ipcMain.on("window-close", () => {
    win == null ? void 0 : win.close();
  });
  ipcMain.handle("get-file-url", async (_event, filePath) => {
    return pathToFileURL(filePath).href;
  });
  ipcMain.handle("save-file", async (_event, filePath, content) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, "utf-8", (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
  ipcMain.handle("dialog:openFile", async (_event, options) => {
    if (!win) return { canceled: true, filePaths: [] };
    return await dialog.showOpenDialog(win, options);
  });
  ipcMain.handle("ensure-dir", async (_event, dirPath) => {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
  ipcMain.handle("get-paths", async () => {
    let projectRoot;
    if (app.isPackaged) {
      projectRoot = path.dirname(process.resourcesPath);
    } else {
      projectRoot = path.resolve(process.env.APP_ROOT, "../..");
    }
    const outputDir = path.join(projectRoot, "output");
    return { projectRoot, outputDir };
  });
  ipcMain.handle("get-language", async () => {
    const settings = loadSettings();
    return settings.language || "zh";
  });
  ipcMain.handle("set-language", async (_event, lang) => {
    const settings = loadSettings();
    settings.language = lang;
    saveSettings(settings);
    return { success: true };
  });
  let tbUrl = "";
  ipcMain.handle("start-tensorboard", async (_event, { logDir, host, port }) => {
    const settings = loadSettings();
    settings.isTensorboardEnabled = true;
    settings.tbLogDir = logDir;
    settings.tbHost = host;
    settings.tbPort = port;
    saveSettings(settings);
    return new Promise((resolve, reject) => {
      if (activeTensorboardProcess) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", activeTensorboardProcess.pid, "/f", "/t"]);
          }
          activeTensorboardProcess.kill();
        } catch (e) {
          console.error("Error killing tensorboard:", e);
        }
        activeTensorboardProcess = null;
      }
      console.log(`Starting TensorBoard on ${host}:${port} for dir ${logDir}`);
      console.log(`Starting TensorBoard on ${host}:${port} for dir ${logDir}`);
      const { projectRoot } = resolveModelsRoot();
      const pythonExe = getPythonExe(projectRoot);
      let tensorboardArgs = ["-m", "tensorboard.main", "--logdir", logDir, "--host", host, "--port", String(port)];
      if (!fs.existsSync(logDir)) {
        console.warn(`Log dir ${logDir} does not exist, creating it.`);
        try {
          fs.mkdirSync(logDir, { recursive: true });
        } catch (e) {
          console.error(e);
        }
      }
      const tbProcess = spawn(pythonExe, tensorboardArgs, {
        env: { ...process.env, PYTHONUTF8: "1" }
      });
      activeTensorboardProcess = tbProcess;
      tbProcess.stdout.on("data", (data) => console.log("[TB Out]:", data.toString()));
      tbProcess.stderr.on("data", (data) => console.log("[TB Err]:", data.toString()));
      tbProcess.on("error", (err) => {
        console.error("Failed to start TensorBoard:", err);
        reject(err.message);
      });
      const checkPort = (host2, port2, timeout) => {
        return new Promise((res) => {
          const startTime = Date.now();
          const timer = setInterval(() => {
            const client = new (require$1("net")).Socket();
            client.once("error", () => {
            });
            client.connect(port2, host2, () => {
              client.end();
              clearInterval(timer);
              res(true);
            });
            if (Date.now() - startTime > timeout) {
              clearInterval(timer);
              res(false);
            }
          }, 500);
        });
      };
      checkPort(host, port, 1e4).then((isReady) => {
        if (isReady && activeTensorboardProcess && !activeTensorboardProcess.killed) {
          console.log(`[TB] Port ${port} is ready.`);
          tbUrl = `http://${host}:${port}`;
          resolve({ success: true, url: tbUrl });
        } else {
          const s = loadSettings();
          s.isTensorboardEnabled = false;
          saveSettings(s);
          reject("TensorBoard process failed to start or port timed out");
        }
      });
    });
  });
  ipcMain.handle("stop-tensorboard", async () => {
    const settings = loadSettings();
    settings.isTensorboardEnabled = false;
    saveSettings(settings);
    if (activeTensorboardProcess) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", activeTensorboardProcess.pid, "/f", "/t"]);
        }
        activeTensorboardProcess.kill();
        activeTensorboardProcess = null;
        tbUrl = "";
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    tbUrl = "";
    return { success: true };
  });
  ipcMain.handle("get-tensorboard-status", async () => {
    const isRunning = !!(activeTensorboardProcess && !activeTensorboardProcess.killed);
    const settings = loadSettings();
    return {
      isRunning,
      url: tbUrl || (isRunning ? `http://${settings.tbHost || "localhost"}:${settings.tbPort || 6006}` : ""),
      settings: {
        host: settings.tbHost || "localhost",
        port: settings.tbPort || 6006,
        logDir: settings.tbLogDir || "",
        autoStart: settings.isTensorboardEnabled || false
      }
    };
  });
  ipcMain.handle("run-backend", async (_event, args) => {
    return new Promise((resolve, reject) => {
      console.log("Running backend with args:", args);
      let backendProcess;
      if (app.isPackaged) {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        const scriptPath = path.join(process.resourcesPath, "backend", "main.py");
        const modelsDir = path.join(path.dirname(process.resourcesPath), "models", "index-tts", "hub");
        console.log("Spawning Packaged Backend with Python:", pythonExe);
        console.log("Target Script:", scriptPath);
        backendProcess = spawn(pythonExe, [scriptPath, "--json", "--model_dir", modelsDir, ...args], {
          env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
        });
      } else {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        const pythonScript = path.join(process.env.APP_ROOT, "../backend/main.py");
        const modelsDir = path.join(projectRoot, "models", "index-tts", "hub");
        const pythonArgs = [pythonScript, "--json", "--model_dir", modelsDir, ...args];
        console.log("Spawning Python Script:", pythonScript, "with", pythonExe);
        backendProcess = spawn(pythonExe, pythonArgs, {
          env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
        });
      }
      activeBackendProcess = backendProcess;
      let outputData = "";
      let errorData = "";
      if (backendProcess) {
        backendProcess.stdout.on("data", (data) => {
          const str = data.toString();
          const lines = str.split("\n");
          lines.forEach((line) => {
            const progressMatch = line.match(/\[PROGRESS\]\s*(\d+)/);
            if (progressMatch) {
              const p = parseInt(progressMatch[1], 10);
              _event.sender.send("backend-progress", p);
            }
            const partialMatch = line.match(/\[PARTIAL\]\s*(.*)/);
            if (partialMatch) {
              try {
                const pData = JSON.parse(partialMatch[1].trim());
                _event.sender.send("backend-partial-result", pData);
              } catch (e) {
                console.error("Failed to parse partial:", e);
              }
            }
            const depsMatch = line.match(/\[DEPS_INSTALLING\]\s*(.*)/);
            if (depsMatch) {
              const packageDesc = depsMatch[1].trim();
              _event.sender.send("backend-deps-installing", packageDesc);
            }
            const depsDoneMatch = line.match(/\[DEPS_DONE\]\s*(.*)/);
            if (depsDoneMatch) {
              _event.sender.send("backend-deps-done");
            }
          });
          console.log("[Py Stdout]:", str);
          outputData += str;
        });
        backendProcess.stderr.on("data", (data) => {
          const str = data.toString();
          console.error("[Py Stderr]:", str);
          errorData += str;
        });
        backendProcess.on("close", (code) => {
          if (activeBackendProcess === backendProcess) activeBackendProcess = null;
          if (code !== 0) {
            reject(new Error(`Python process exited with code ${code}. Error: ${errorData}`));
            return;
          }
          try {
            const startMarker = "__JSON_START__";
            const endMarker = "__JSON_END__";
            const startIndex = outputData.indexOf(startMarker);
            const endIndex = outputData.lastIndexOf(endMarker);
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
              let jsonFullStr = outputData.substring(startIndex + startMarker.length, endIndex).trim();
              const firstBrace = jsonFullStr.indexOf("{");
              const lastBrace = jsonFullStr.lastIndexOf("}");
              const firstBracket = jsonFullStr.indexOf("[");
              const lastBracket = jsonFullStr.lastIndexOf("]");
              let startIdx = -1;
              let endIdx = -1;
              if (firstBrace !== -1 && firstBracket !== -1) {
                if (firstBrace < firstBracket) {
                  startIdx = firstBrace;
                  endIdx = lastBrace;
                } else {
                  startIdx = firstBracket;
                  endIdx = lastBracket;
                }
              } else if (firstBrace !== -1) {
                startIdx = firstBrace;
                endIdx = lastBrace;
              } else if (firstBracket !== -1) {
                startIdx = firstBracket;
                endIdx = lastBracket;
              }
              if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const cleanJsonStr = jsonFullStr.substring(startIdx, endIdx + 1);
                const result = JSON.parse(cleanJsonStr);
                resolve(result);
              } else {
                const result = JSON.parse(jsonFullStr);
                resolve(result);
              }
            } else {
              console.warn("JSON markers not found or invalid in output");
              resolve({ rawOutput: outputData, rawError: errorData });
            }
          } catch (e) {
            console.error("Failed to parse backend output. Raw:", outputData);
            reject(new Error(`Failed to parse backend output: ${e}`));
          }
        });
      } else {
        reject(new Error("Failed to spawn backend process"));
      }
    });
  });
  ipcMain.handle("cache-video", async (_event, filePath) => {
    try {
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, "..");
      }
      const cacheDir = path.join(projectRoot, ".cache");
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const normalizedInput = path.normalize(filePath);
      const normalizedCache = path.normalize(cacheDir);
      if (normalizedInput.startsWith(normalizedCache)) {
        return normalizedInput;
      }
      const crypto = require$1("node:crypto");
      const hash = crypto.createHash("md5").update(normalizedInput).digest("hex");
      const basename = path.basename(filePath);
      const safeBasename = `${hash.substring(0, 12)}_${basename}`;
      const destPath = path.join(cacheDir, safeBasename);
      if (fs.existsSync(destPath)) {
        console.log(`Using existing cached file for: ${filePath}`);
        return destPath;
      }
      console.log(`Caching new file: ${filePath} -> ${destPath}`);
      await fs.promises.copyFile(filePath, destPath);
      return destPath;
    } catch (error) {
      console.error("Failed to cache video:", error);
      throw error;
    }
  });
  ipcMain.handle("open-folder", async (_event, filePath) => {
    try {
      console.log(`[Main] open-folder requested for: ${filePath}`);
      if (!filePath) return false;
      let currentPath = path.normalize(filePath);
      console.log(`[Main] Normalized starting path: ${currentPath}`);
      while (currentPath && currentPath !== path.parse(currentPath).root) {
        if (fs.existsSync(currentPath)) {
          const stat = fs.statSync(currentPath);
          if (stat.isDirectory()) {
            console.log(`[Main] Opening existing directory: ${currentPath}`);
            await shell.openPath(currentPath);
          } else {
            console.log(`[Main] Showing existing file in folder: ${currentPath}`);
            shell.showItemInFolder(currentPath);
          }
          return true;
        }
        console.log(`[Main] Path does not exist, trying parent: ${currentPath}`);
        currentPath = path.dirname(currentPath);
      }
      if (currentPath && fs.existsSync(currentPath)) {
        await shell.openPath(currentPath);
        return true;
      }
      console.error(`[Main] Could not find any existing parent directory for: ${filePath}`);
      return false;
    } catch (e) {
      console.error("[Main] Failed to open folder:", e);
      return false;
    }
  });
  ipcMain.handle("open-external", async (_event, filePath) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (e) {
      console.error("Failed to open external:", e);
      return false;
    }
  });
  ipcMain.handle("kill-backend", async () => {
    if (activeBackendProcess) {
      try {
        const pid = activeBackendProcess.pid;
        console.log(`Killing python process ${pid}...`);
        if (process.platform === "win32") {
          const { exec: exec2 } = await import("child_process");
          exec2(`taskkill /pid ${pid} /T /F`);
        } else {
          activeBackendProcess.kill("SIGKILL");
        }
        activeBackendProcess = null;
        return true;
      } catch (e) {
        console.error("Failed to kill backend:", e);
        return false;
      }
    }
    return true;
  });
  let activeMonitorProcess = null;
  let latestMonitorStats = null;
  ipcMain.handle("start-resource-monitor", async (_event) => {
    if (activeMonitorProcess) return { success: true, message: "Already running" };
    return new Promise((resolve, reject) => {
      var _a, _b;
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let scriptPath = "";
        if (app.isPackaged) {
          scriptPath = path.join(process.resourcesPath, "backend", "monitor.py");
        } else {
          const candidates = [
            path.join(projectRoot, "app", "backend", "monitor.py"),
            path.join(projectRoot, "backend", "monitor.py")
          ];
          for (const cand of candidates) {
            if (fs.existsSync(cand)) {
              scriptPath = cand;
              break;
            }
          }
        }
        if (!fs.existsSync(scriptPath)) {
          const fallbackPath = path.join(projectRoot, "monitor.py");
          if (fs.existsSync(fallbackPath)) {
            scriptPath = fallbackPath;
          } else {
            reject(new Error(`Monitor script not found at ${scriptPath}`));
            return;
          }
        }
        console.log(`[Monitor] Spawning: ${pythonExe} ${scriptPath}`);
        activeMonitorProcess = spawn(pythonExe, [scriptPath], {
          env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
        });
        (_a = activeMonitorProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
          const str = data.toString();
          const startMarker = "__JSON_START__";
          const endMarker = "__JSON_END__";
          const lines = str.split("\n");
          for (const line of lines) {
            const startIndex = line.indexOf(startMarker);
            const endIndex = line.lastIndexOf(endMarker);
            if (startIndex !== -1 && endIndex !== -1) {
              try {
                const jsonStr = line.substring(startIndex + startMarker.length, endIndex);
                latestMonitorStats = JSON.parse(jsonStr);
                _event.sender.send("resource-stats", latestMonitorStats);
              } catch (e) {
                console.error("[Monitor] Parse error:", e);
              }
            }
          }
        });
        (_b = activeMonitorProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
          console.error(`[Monitor Err]: ${data}`);
        });
        activeMonitorProcess.on("close", (code) => {
          console.log(`[Monitor] Exited with code ${code}`);
          activeMonitorProcess = null;
        });
        resolve({ success: true });
      } catch (e) {
        console.error("[Monitor] Start failed:", e);
        reject(e);
      }
    });
  });
  ipcMain.handle("stop-resource-monitor", async () => {
    if (activeMonitorProcess) {
      try {
        activeMonitorProcess.kill();
        activeMonitorProcess = null;
        latestMonitorStats = null;
      } catch (e) {
        console.error("[Monitor] Stop failed:", e);
      }
    }
    return { success: true };
  });
  ipcMain.handle("get-resource-monitor-stats", async () => {
    return latestMonitorStats;
  });
  ipcMain.handle("open-backend-log", async () => {
    try {
      let projectRoot;
      if (app.isPackaged) {
        projectRoot = path.dirname(process.resourcesPath);
      } else {
        projectRoot = path.resolve(process.env.APP_ROOT, "..");
      }
      const logPath = path.join(projectRoot, "logs", "backend_debug.log");
      if (!fs.existsSync(logPath)) {
        console.error(`Log file not found at: ${logPath}`);
        return { success: false, error: "Log file not found" };
      }
      const error = await shell.openPath(logPath);
      if (error) {
        console.error(`Failed to open log: ${error}`);
        return { success: false, error };
      }
      return { success: true };
    } catch (e) {
      console.error("Failed to open backend log:", e);
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("fix-python-env", async (_event) => {
    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let requirementsPath = "";
        if (app.isPackaged) {
          requirementsPath = path.join(projectRoot, "requirements.txt");
          if (!fs.existsSync(requirementsPath)) {
            const internalReq = path.join(process.resourcesPath, "backend", "requirements.txt");
            if (fs.existsSync(internalReq)) requirementsPath = internalReq;
          }
        } else {
          requirementsPath = path.join(projectRoot, "requirements.txt");
        }
        if (!fs.existsSync(pythonExe) && pythonExe !== "python") {
          resolve({ success: false, error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }
        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: `找不到 requirements.txt。请确认文件存在于 ${projectRoot}` });
          return;
        }
        console.log(`[FixEnv] Starting repair... Python: ${pythonExe}, Req: ${requirementsPath}`);
        const installProcess = spawn(pythonExe, ["-m", "pip", "install", "-r", requirementsPath], {
          env: { ...process.env, PYTHONUTF8: "1" }
        });
        let output = "";
        let errorOut = "";
        installProcess.stdout.on("data", (data) => {
          console.log(`[Pip]: ${data}`);
          output += data.toString();
        });
        installProcess.stderr.on("data", (data) => {
          console.error(`[Pip Err]: ${data}`);
          errorOut += data.toString();
        });
        installProcess.on("close", (code) => {
          if (code === 0) {
            console.log("[FixEnv] Success!");
            resolve({ success: true, output });
          } else {
            console.error("[FixEnv] Failed code:", code);
            resolve({ success: false, error: `Pip install failed (Code ${code}). 
Error: ${errorOut}` });
          }
        });
        installProcess.on("error", (err) => {
          resolve({ success: false, error: `Spawn error: ${err.message}` });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });
  ipcMain.handle("check-python-env", async (_event) => {
    return new Promise((resolve) => {
      try {
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        let requirementsPath = "";
        let checkScriptPath = "";
        if (app.isPackaged) {
          requirementsPath = path.join(projectRoot, "requirements.txt");
          if (!fs.existsSync(requirementsPath)) {
            const internalReq = path.join(process.resourcesPath, "backend", "requirements.txt");
            if (fs.existsSync(internalReq)) requirementsPath = internalReq;
          }
          checkScriptPath = path.join(process.resourcesPath, "backend", "check_requirements.py");
        } else {
          requirementsPath = path.join(projectRoot, "requirements.txt");
          checkScriptPath = path.join(projectRoot, "backend", "check_requirements.py");
        }
        if (!fs.existsSync(pythonExe)) {
          resolve({ success: false, status: "missing_python", error: `找不到 Python 解释器。请确认 python 文件夹存在于 ${projectRoot}` });
          return;
        }
        if (!fs.existsSync(requirementsPath)) {
          resolve({ success: false, error: "requirements.txt not found" });
          return;
        }
        if (!fs.existsSync(checkScriptPath)) {
          resolve({ success: false, error: "check_requirements.py not found" });
          return;
        }
        const checkProcess = spawn(pythonExe, [checkScriptPath, requirementsPath, "--json"], {
          env: { ...process.env, PYTHONUTF8: "1" }
        });
        let output = "";
        checkProcess.stdout.on("data", (data) => output += data.toString());
        checkProcess.stderr.on("data", (data) => console.error("[CheckEnv Err]:", data.toString()));
        checkProcess.on("close", (code) => {
          try {
            const jsonStart = output.indexOf("{");
            const jsonEnd = output.lastIndexOf("}");
            if (jsonStart !== -1 && jsonEnd !== -1) {
              const jsonStr = output.substring(jsonStart, jsonEnd + 1);
              const result = JSON.parse(jsonStr);
              resolve({ success: true, missing: result.missing || [] });
            } else {
              if (code === 0 && !output.trim()) resolve({ success: true, missing: [] });
              if (code !== 0) resolve({ success: false, error: "Dependency check failed (non-zero exit)" });
              else resolve({ success: true, missing: [] });
            }
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${e.message}` });
          }
        });
        checkProcess.on("error", (err) => {
          resolve({ success: false, error: err.message });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });
  const resolveModelsRoot = () => {
    let modelsRoot = "";
    let projectRoot = "";
    if (app.isPackaged) {
      projectRoot = path.dirname(process.resourcesPath);
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        modelsRoot = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "models");
      } else {
        modelsRoot = path.join(projectRoot, "models");
      }
    } else {
      projectRoot = path.resolve(process.env.APP_ROOT, "../..");
      modelsRoot = path.join(projectRoot, "models");
    }
    return { modelsRoot, projectRoot };
  };
  const scanPythonEnvironments = (projectRoot) => {
    const envs = [];
    try {
      if (!fs.existsSync(projectRoot)) return envs;
      const files = fs.readdirSync(projectRoot);
      for (const f of files) {
        const fullPath = path.join(projectRoot, f);
        if (fs.statSync(fullPath).isDirectory()) {
          if (f === "python" || f.startsWith("python_")) {
            const exePath = path.join(fullPath, "python.exe");
            if (fs.existsSync(exePath)) {
              envs.push({ name: f, path: exePath });
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to scan environments:", e);
    }
    return envs;
  };
  const scanCondaEnvironments = async () => {
    return new Promise((resolve) => {
      const { exec: exec2 } = require$1("child_process");
      exec2("conda env list --json", { timeout: 3e3 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          if (data && data.envs && Array.isArray(data.envs)) {
            const results = data.envs.map((envPath) => {
              const name = path.basename(envPath);
              const pythonPath = path.join(envPath, "python.exe");
              if (fs.existsSync(pythonPath)) {
                return { name: `${name} [Conda]`, path: pythonPath };
              }
              return null;
            }).filter(Boolean);
            resolve(results);
          } else {
            resolve([]);
          }
        } catch (e) {
          console.error("Failed to parse conda JSON:", e);
          resolve([]);
        }
      });
    });
  };
  const getPythonExe = (projectRoot) => {
    const settings = loadSettings();
    if (settings.userPythonPath && fs.existsSync(settings.userPythonPath)) {
      console.log(`[PythonLookup] Using user-selected path: ${settings.userPythonPath}`);
      return settings.userPythonPath;
    }
    if (process.env.CONDA_PREFIX) {
      const condaPython = path.join(process.env.CONDA_PREFIX, "python.exe");
      if (fs.existsSync(condaPython)) {
        console.log(`[PythonLookup] Detected Conda environment: ${process.env.CONDA_DEFAULT_ENV}`);
        return condaPython;
      }
    }
    if (process.env.VIRTUAL_ENV) {
      const venvPython = path.join(process.env.VIRTUAL_ENV, "Scripts", "python.exe");
      if (fs.existsSync(venvPython)) {
        console.log(`[PythonLookup] Detected Virtual Env: ${process.env.VIRTUAL_ENV}`);
        return venvPython;
      }
    }
    const searchDirs = [projectRoot, path.dirname(projectRoot)];
    for (const dir of searchDirs) {
      const embeddedDP = path.join(dir, "python_embeded_DP", "python.exe");
      if (fs.existsSync(embeddedDP)) {
        console.log(`[PythonLookup] Found embedded_DP in ${dir}: ${embeddedDP}`);
        return embeddedDP;
      }
    }
    const localPython = path.join(projectRoot, "python", "python.exe");
    if (fs.existsSync(localPython)) {
      console.log(`[PythonLookup] Found local python: ${localPython}`);
      return localPython;
    }
    if (app.isPackaged) {
      const resourcesPython = path.join(process.resourcesPath, "python", "python.exe");
      if (fs.existsSync(resourcesPython)) return resourcesPython;
    }
    return "python";
  };
  ipcMain.handle("get-python-status", async () => {
    const { projectRoot } = resolveModelsRoot();
    const pythonExe = getPythonExe(projectRoot);
    const localEnvs = scanPythonEnvironments(projectRoot);
    const condaEnvs = await scanCondaEnvironments();
    const availableEnvs = [...localEnvs, ...condaEnvs];
    let isReady = false;
    if (pythonExe === "python") {
      isReady = await new Promise((res) => {
        exec("python --version", (err) => res(!err));
      });
    } else if (pythonExe && fs.existsSync(pythonExe)) {
      isReady = true;
    }
    const embeddedDP = path.join(projectRoot, "python_embeded_DP", "python.exe");
    const isInternal = pythonExe === embeddedDP;
    const isSamePath = (p1, p2) => {
      if (!p1 || !p2) return false;
      const r1 = path.resolve(p1);
      const r2 = path.resolve(p2);
      return process.platform === "win32" ? r1.toLowerCase() === r2.toLowerCase() : r1 === r2;
    };
    let displayName = "Unknown";
    if (pythonExe === "python") {
      displayName = "System Python";
    } else if (pythonExe) {
      const matchingConda = condaEnvs.find((c) => isSamePath(c.path, pythonExe));
      if (matchingConda) {
        displayName = matchingConda.name;
      } else {
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
          displayName = relative.split(/[/\\]/)[0];
        } else {
          displayName = path.basename(path.dirname(pythonExe));
        }
      }
    }
    return {
      path: pythonExe || "",
      displayName,
      status: isReady ? "ready" : "missing",
      isInternal,
      availableEnvs
    };
  });
  ipcMain.handle("set-python-env", async (_event, filePath) => {
    const settings = loadSettings();
    settings.userPythonPath = filePath;
    saveSettings(settings);
    const { projectRoot } = resolveModelsRoot();
    const pythonExe = getPythonExe(projectRoot);
    const localEnvs = scanPythonEnvironments(projectRoot);
    const condaEnvs = await scanCondaEnvironments();
    const availableEnvs = [...localEnvs, ...condaEnvs];
    const isReady = pythonExe === "python" ? true : pythonExe ? fs.existsSync(pythonExe) : false;
    const embeddedDP = path.join(projectRoot, "python_embeded_DP", "python.exe");
    const isSamePath = (p1, p2) => {
      if (!p1 || !p2) return false;
      const r1 = path.resolve(p1);
      const r2 = path.resolve(p2);
      return process.platform === "win32" ? r1.toLowerCase() === r2.toLowerCase() : r1 === r2;
    };
    let displayName = "Unknown";
    if (pythonExe === "python") {
      displayName = "System Python";
    } else if (pythonExe) {
      const matchingConda = condaEnvs.find((c) => isSamePath(c.path, pythonExe));
      if (matchingConda) {
        displayName = matchingConda.name;
      } else {
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
          displayName = relative.split(/[/\\]/)[0];
        } else {
          displayName = path.basename(path.dirname(pythonExe));
        }
      }
    }
    return {
      success: true,
      path: pythonExe || "",
      displayName,
      status: isReady ? "ready" : "missing",
      isInternal: pythonExe === embeddedDP,
      availableEnvs
    };
  });
  ipcMain.handle("pick-python-exe", async () => {
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: "Select Python Interpreter (python.exe)",
      filters: [{ name: "Executables", extensions: ["exe"] }],
      properties: ["openFile"]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      const settings = loadSettings();
      settings.userPythonPath = selectedPath;
      saveSettings(settings);
      const { projectRoot } = resolveModelsRoot();
      const pythonExe = getPythonExe(projectRoot);
      const isReady = pythonExe === "python" ? true : pythonExe ? fs.existsSync(pythonExe) : false;
      const embeddedDP = path.join(projectRoot, "python_embeded_DP", "python.exe");
      let displayName = "Unknown";
      if (pythonExe === "python") displayName = "System Python";
      else if (pythonExe) {
        const relative = path.relative(projectRoot, pythonExe);
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) displayName = relative.split(/[/\\]/)[0];
        else displayName = path.basename(path.dirname(pythonExe));
      }
      return {
        success: true,
        path: pythonExe || "",
        displayName,
        status: isReady ? "ready" : "missing",
        isInternal: pythonExe === embeddedDP
      };
    }
    return { canceled: true };
  });
  ipcMain.handle("check-model-status", async (_event) => {
    return new Promise((resolve) => {
      try {
        const { modelsRoot } = resolveModelsRoot();
        console.log("[CheckModel] Models Root:", modelsRoot);
        const checkDir = (subpath) => {
          for (const p of subpath) {
            const fullPath = path.join(modelsRoot, p);
            if (fs.existsSync(fullPath)) return true;
          }
          return false;
        };
        const status = {
          whisperx: checkDir(["faster-whisper-large-v3-turbo-ct2", "whisperx/faster-whisper-large-v3-turbo-ct2"]),
          alignment: checkDir(["alignment"]),
          index_tts: checkDir(["index-tts", "index-tts/hub"]),
          qwen: checkDir(["Qwen2.5-7B-Instruct", "qwen/Qwen2.5-7B-Instruct"]),
          qwen_tokenizer: checkDir(["Qwen3-TTS-Tokenizer-12Hz", "Qwen/Qwen3-TTS-Tokenizer-12Hz"]),
          qwen_17b_base: checkDir(["Qwen3-TTS-12Hz-1.7B-Base", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"]),
          qwen_17b_design: checkDir(["Qwen3-TTS-12Hz-1.7B-VoiceDesign", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"]),
          qwen_17b_custom: checkDir(["Qwen3-TTS-12Hz-1.7B-CustomVoice", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"]),
          qwen_06b_base: checkDir(["Qwen3-TTS-12Hz-0.6B-Base", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"]),
          qwen_06b_custom: checkDir(["Qwen3-TTS-12Hz-0.6B-CustomVoice", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"]),
          rife: checkDir(["rife", "rife-ncnn-vulkan"])
        };
        resolve({ success: true, status, root: modelsRoot });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });
  ipcMain.handle("check-file-exists", async (_event, filePath) => {
    try {
      if (!filePath) return false;
      return fs.existsSync(filePath);
    } catch (e) {
      console.error("Check file exists error:", e);
      return false;
    }
  });
  ipcMain.handle("read-file", async (_event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      console.error("Read file error:", e);
      return null;
    }
  });
  ipcMain.handle("read-project-folder", async (_event, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) return { error: "Folder not found" };
      const tryRead = (candidates) => {
        for (const relPath of candidates) {
          const p = path.join(folderPath, relPath);
          if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
        }
        return null;
      };
      return {
        datasetConfig: tryRead(["dataset.toml", path.join("dataset", "dataset.toml")]),
        evalDatasetConfig: tryRead(["evaldataset.toml", path.join("dataset", "evaldataset.toml")]),
        trainConfig: tryRead(["trainconfig.toml", path.join("train_config", "trainconfig.toml")])
      };
    } catch (e) {
      console.error("Read project folder error:", e);
      return { error: e.message };
    }
  });
  ipcMain.handle("set-session-folder", async (_event, folderPath) => {
    if (!folderPath) {
      cachedOutputFolder = null;
      console.log(`[Session] Cache cleared`);
      return { success: true };
    }
    if (fs.existsSync(folderPath)) {
      cachedOutputFolder = folderPath;
      console.log(`[Session] Explicitly locked to: ${folderPath}`);
      return { success: true };
    }
    return { success: false, error: "Invalid path" };
  });
  let cachedOutputFolder = null;
  const getTodayOutputFolder = (projectRoot) => {
    if (cachedOutputFolder && fs.existsSync(cachedOutputFolder)) {
      return cachedOutputFolder;
    }
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const outputDir = path.join(projectRoot, "output", timestamp);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    cachedOutputFolder = outputDir;
    console.log(`[OutputFolder] Created session folder: ${outputDir}`);
    return outputDir;
  };
  ipcMain.handle("create-new-project", async () => {
    try {
      const { projectRoot } = resolveModelsRoot();
      cachedOutputFolder = null;
      const folder = getTodayOutputFolder(projectRoot);
      const defaultTrain = `[model]
type = 'sdxl'
checkpoint_path = ''
unet_lr = 4e-05
text_encoder_1_lr = 2e-05
text_encoder_2_lr = 2e-05
min_snr_gamma = 5
dtype = 'bfloat16'

[optimizer]
type = 'adamw_optimi'
lr = 2e-5
betas = [0.9, 0.99]
weight_decay = 0.01
eps = 1e-8

[adapter]
type = 'lora'
rank = 32
dtype = 'bfloat16'

# Training settings
epochs = 10
micro_batch_size_per_gpu = 1
gradient_accumulation_steps = 1
`;
      const defaultDataset = `[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
min_ar = 0.5
max_ar = 2.0
num_repeats = 1
`;
      const defaultEval = `[[datasets]]
input_path = ''
resolutions = [1024]
enable_ar_bucket = true
`;
      fs.writeFileSync(path.join(folder, "trainconfig.toml"), defaultTrain, "utf-8");
      fs.writeFileSync(path.join(folder, "dataset.toml"), defaultDataset, "utf-8");
      fs.writeFileSync(path.join(folder, "evaldataset.toml"), defaultEval, "utf-8");
      console.log(`[NewProject] Created at: ${folder}`);
      return { success: true, path: folder };
    } catch (e) {
      console.error("Create new project error:", e);
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("save-to-date-folder", async (_event, args) => {
    try {
      const { filename, content } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, content, "utf-8");
      const normalizedPath = filePath.replace(/\\/g, "/");
      const normalizedFolder = folder.replace(/\\/g, "/");
      return { success: true, path: normalizedPath, folder: normalizedFolder };
    } catch (e) {
      console.error("Save to date folder error:", e);
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("delete-from-date-folder", async (_event, args) => {
    try {
      const { filename } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const filePath = path.join(folder, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: "File not found" };
    } catch (e) {
      console.error("Delete from date folder error:", e);
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("copy-to-date-folder", async (_event, args) => {
    try {
      const { sourcePath, filename } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const destPath = path.join(folder, filename || path.basename(sourcePath));
      fs.copyFileSync(sourcePath, destPath);
      return { success: true, path: destPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("copy-folder-configs-to-date", async (_event, args) => {
    try {
      const { sourceFolderPath } = args;
      const { projectRoot } = resolveModelsRoot();
      const folder = getTodayOutputFolder(projectRoot);
      const copiedFiles = [];
      const stat = fs.statSync(sourceFolderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: "Source is not a directory" };
      }
      const configFiles = ["trainconfig.toml", "dataset.toml", "evaldataset.toml"];
      for (const configFile of configFiles) {
        const srcPath = path.join(sourceFolderPath, configFile);
        if (fs.existsSync(srcPath)) {
          const destPath = path.join(folder, configFile);
          fs.copyFileSync(srcPath, destPath);
          copiedFiles.push(configFile);
          console.log(`[CopyConfigs] Copied exact match ${configFile}`);
        }
      }
      const files = fs.readdirSync(sourceFolderPath);
      for (const file of files) {
        if (file.endsWith(".toml") && !configFiles.includes(file)) {
          const srcPath = path.join(sourceFolderPath, file);
          const content = fs.readFileSync(srcPath, "utf-8");
          let targetName = "";
          if (content.includes("[model]") && content.includes("type =") || content.includes("training_arguments")) {
            targetName = "trainconfig.toml";
          } else if (content.includes("[[datasets]]") || content.includes("[dataset]") || content.includes("[[directory]]")) {
            if (content.includes("enable_ar_bucket") && !copiedFiles.includes("dataset.toml")) {
              targetName = "dataset.toml";
            } else if (!copiedFiles.includes("evaldataset.toml")) {
              targetName = "evaldataset.toml";
            } else if (!copiedFiles.includes("dataset.toml")) {
              targetName = "dataset.toml";
            }
          }
          if (targetName) {
            if (!copiedFiles.includes(targetName)) {
              const destPath = path.join(folder, targetName);
              fs.copyFileSync(srcPath, destPath);
              copiedFiles.push(targetName);
              console.log(`[CopyConfigs] Sniffed ${file} as ${targetName}`);
            }
          }
        }
      }
      const subDirs = ["dataset", "train_config"];
      for (const subDir of subDirs) {
        const subDirPath = path.join(sourceFolderPath, subDir);
        if (fs.existsSync(subDirPath) && fs.statSync(subDirPath).isDirectory()) {
          const subFiles = fs.readdirSync(subDirPath);
          for (const file of subFiles) {
            if (file.endsWith(".toml")) {
              const srcPath = path.join(subDirPath, file);
              let targetName = "";
              if (subDir === "train_config") targetName = "trainconfig.toml";
              if (subDir === "dataset") targetName = "dataset.toml";
              if (targetName && !copiedFiles.includes(targetName)) {
                const destPath = path.join(folder, targetName);
                fs.copyFileSync(srcPath, destPath);
                copiedFiles.push(targetName);
                console.log(`[CopyConfigs] Copied from subDir ${subDir}/${file} as ${targetName}`);
              } else {
                const destPath = path.join(folder, file);
                fs.copyFileSync(srcPath, destPath);
                copiedFiles.push(file);
              }
            }
          }
        }
      }
      return { success: true, copiedFiles, outputFolder: folder };
    } catch (e) {
      console.error("Copy folder configs error:", e);
      return { success: false, error: e.message };
    }
  });
  let trainingProcess = null;
  let trainingLogQueue = [];
  let currentLogFilePath = null;
  ipcMain.handle("start-training", async (_event, args) => {
    if (trainingProcess) return { success: false, message: "训练已经在进行中" };
    return new Promise((resolve, reject) => {
      var _a, _b;
      try {
        const {
          configPath,
          // Optional args
          resumeFromCheckpoint,
          resetDataloader,
          regenerateCache,
          trustCache,
          cacheOnly,
          forceIKnow,
          // i_know_what_i_am_doing
          dumpDataset,
          resetOptimizerParams
        } = args;
        if (!configPath) {
          reject(new Error("Missing configPath"));
          return;
        }
        let baseOutputDir = "";
        try {
          const configContent = fs.readFileSync(configPath, "utf8");
          const config = parse(configContent);
          baseOutputDir = config.output_dir;
        } catch (e) {
          console.warn("[Training] Failed to parse config for output_dir:", e);
        }
        const configDir = path.dirname(configPath);
        const startTime = Date.now();
        currentLogFilePath = null;
        const logBuffer = [];
        let detectionAttempts = 0;
        const maxDetectionAttempts = 60;
        const detectAndInitLog = () => {
          if (currentLogFilePath || !baseOutputDir || !fs.existsSync(baseOutputDir)) return;
          try {
            const dirs = fs.readdirSync(baseOutputDir).filter((f) => {
              try {
                return fs.statSync(path.join(baseOutputDir, f)).isDirectory();
              } catch {
                return false;
              }
            });
            const sessions = dirs.filter((d) => /^\d{8}_\d{2}-\d{2}-\d{2}$/.test(d));
            if (sessions.length > 0) {
              const newest = sessions.sort().reverse()[0];
              const newestPath = path.join(baseOutputDir, newest);
              const stats = fs.statSync(newestPath);
              if (stats.birthtimeMs > startTime - 3e4) {
                currentLogFilePath = path.join(configDir, `${newest}.log`);
                console.log(`[Training] Detected session: ${newest}. Writing log to PROJECT ROOT: ${currentLogFilePath}`);
                if (logBuffer.length > 0) {
                  fs.writeFileSync(currentLogFilePath, logBuffer.join("\n") + "\n", "utf-8");
                  logBuffer.length = 0;
                }
              }
            }
          } catch (e) {
            console.error("[Training] Error detecting session folder:", e);
          }
        };
        const detectionInterval = setInterval(() => {
          detectionAttempts++;
          detectAndInitLog();
          if (currentLogFilePath || detectionAttempts >= maxDetectionAttempts || !trainingProcess) {
            clearInterval(detectionInterval);
          }
        }, 5e3);
        const { projectRoot } = resolveModelsRoot();
        const pythonExe = getPythonExe(projectRoot);
        if (!fs.existsSync(pythonExe) && pythonExe !== "python") {
          reject(new Error(`Python interpreter not found at ${pythonExe}`));
          return;
        }
        let scriptPath = "";
        if (app.isPackaged) {
          scriptPath = path.join(process.resourcesPath, "backend", "core", "train.py");
        } else {
          scriptPath = path.join(process.env.APP_ROOT, "../backend/core/train.py");
        }
        if (!fs.existsSync(scriptPath)) {
          console.log(`[Training] Script not found at ${scriptPath}, checking legacy location...`);
          if (!fs.existsSync(scriptPath)) {
            reject(new Error(`Train script not found at ${scriptPath}`));
            return;
          }
        }
        console.log(`[Training] Starting with Python: ${pythonExe}`);
        console.log(`[Training] Script: ${scriptPath}`);
        const pythonArgs = [scriptPath, "--config", configPath];
        if (resumeFromCheckpoint && typeof resumeFromCheckpoint === "string" && resumeFromCheckpoint.trim() !== "") {
          pythonArgs.push("--resume_from_checkpoint", resumeFromCheckpoint.trim());
        }
        if (resetDataloader) pythonArgs.push("--reset_dataloader");
        if (resetOptimizerParams) pythonArgs.push("--reset_optimizer_params");
        if (cacheOnly) pythonArgs.push("--cache_only");
        if (forceIKnow) pythonArgs.push("--i_know_what_i_am_doing");
        if (regenerateCache) pythonArgs.push("--regenerate_cache");
        if (trustCache) pythonArgs.push("--trust_cache");
        pythonArgs.push("--deepspeed");
        if (dumpDataset && typeof dumpDataset === "string" && dumpDataset.trim() !== "") {
          pythonArgs.push("--dump_dataset", dumpDataset.trim());
        }
        const timestamp = (/* @__PURE__ */ new Date()).toLocaleString();
        const quoteIfSpace = (s) => s.includes(" ") ? `"${s}"` : s;
        const normalizedExe = pythonExe.replace(/\\/g, "/");
        const normalizedArgs = pythonArgs.map((arg) => {
          if (arg.includes("/") || arg.includes("\\")) {
            return quoteIfSpace(arg.replace(/\\/g, "/"));
          }
          return quoteIfSpace(arg);
        });
        const fullCommandStr = `[${timestamp}] [Command]: ${quoteIfSpace(normalizedExe)} ${normalizedArgs.join(" ")}`;
        console.log(`[Training] Launching: ${fullCommandStr}`);
        trainingLogQueue = [fullCommandStr];
        logBuffer.push(fullCommandStr);
        if (currentLogFilePath) {
          try {
            fs.appendFileSync(currentLogFilePath, fullCommandStr + "\n", "utf-8");
          } catch (err) {
            console.error("Failed to write command to session log:", err);
          }
        }
        _event.sender.send("training-output", fullCommandStr);
        const cwd = path.dirname(scriptPath);
        trainingProcess = spawn(pythonExe, pythonArgs, {
          cwd,
          env: {
            ...process.env,
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8",
            PYTHONUNBUFFERED: "1"
          }
        });
        let stdoutLineBuffer = "";
        let stderrLineBuffer = "";
        const stdoutUtf8 = new TextDecoder("utf-8", { fatal: true });
        const stdoutGbk = new TextDecoder("gbk");
        const stderrUtf8 = new TextDecoder("utf-8", { fatal: true });
        const stderrGbk = new TextDecoder("gbk");
        const decodeChunk = (data, utf8, gbk) => {
          try {
            return utf8.decode(data, { stream: true });
          } catch (e) {
            try {
              return gbk.decode(data, { stream: true });
            } catch (e2) {
              return new TextDecoder("utf-8").decode(data, { stream: true });
            }
          }
        };
        (_a = trainingProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
          const content = decodeChunk(data, stdoutUtf8, stdoutGbk);
          stdoutLineBuffer += content;
          if (stdoutLineBuffer.includes("\n") || stdoutLineBuffer.includes("\r")) {
            const parts = stdoutLineBuffer.split(/[\r\n]/);
            stdoutLineBuffer = parts.pop() || "";
            parts.forEach((line) => {
              if (line.trim()) {
                trainingLogQueue.push(line);
                _event.sender.send("training-output", line);
                console.log(`[Train]: ${line}`);
                const speedMatch = line.match(/iter time \(s\):\s*([\d.]+)\s*samples\/sec:\s*([\d.]+)/);
                if (speedMatch) {
                  _event.sender.send("training-speed", {
                    iterTime: parseFloat(speedMatch[1]),
                    samplesPerSec: parseFloat(speedMatch[2])
                  });
                }
                if (currentLogFilePath) {
                  try {
                    fs.appendFileSync(currentLogFilePath, line + "\n", "utf-8");
                  } catch (err) {
                    console.error("Failed to write to session log:", err);
                  }
                } else {
                  logBuffer.push(line);
                }
              }
            });
          }
        });
        (_b = trainingProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
          const content = decodeChunk(data, stderrUtf8, stderrGbk);
          stderrLineBuffer += content;
          if (stderrLineBuffer.includes("\n") || stderrLineBuffer.includes("\r")) {
            const parts = stderrLineBuffer.split(/[\r\n]/);
            stderrLineBuffer = parts.pop() || "";
            parts.forEach((line) => {
              if (line.trim()) {
                trainingLogQueue.push(line);
                _event.sender.send("training-output", line);
                console.error(`[Train Err]: ${line}`);
                if (currentLogFilePath) {
                  try {
                    fs.appendFileSync(currentLogFilePath, `${line}
`, "utf-8");
                  } catch (err) {
                    console.error("Failed to write to session log:", err);
                  }
                } else {
                  logBuffer.push(`${line}`);
                }
              }
            });
          }
        });
        trainingProcess.on("close", (code) => {
          console.log(`[Training] Exited with code ${code}`);
          trainingProcess = null;
          _event.sender.send("training-status", { type: "finished", code });
        });
        trainingProcess.on("error", (err) => {
          console.error(`[Training] Spawn error: ${err}`);
          trainingProcess = null;
          _event.sender.send("training-status", { type: "error", message: err.message });
        });
        resolve({ success: true, pid: trainingProcess.pid });
      } catch (e) {
        console.error("[Training] Start exception:", e);
        reject(e);
      }
    });
  });
  ipcMain.handle("stop-training", async () => {
    if (trainingProcess) {
      console.log("[Training] Stopping...");
      try {
        if (process.platform === "win32" && trainingProcess.pid) {
          exec(`taskkill /pid ${trainingProcess.pid} /T /F`);
        } else {
          trainingProcess.kill();
        }
        trainingProcess = null;
        currentLogFilePath = null;
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, message: "No training running" };
  });
  ipcMain.handle("get-training-status", async () => {
    return {
      running: !!trainingProcess,
      pid: trainingProcess == null ? void 0 : trainingProcess.pid,
      currentLogFilePath,
      logs: trainingLogQueue
    };
  });
  ipcMain.handle("get-training-logs", async (_event, logPath) => {
    if (!logPath) return [];
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, "utf-8");
        return content.split("\n").filter((l) => l.trim() !== "");
      }
      return [];
    } catch (e) {
      console.error("Failed to read session log:", e);
      return [];
    }
  });
  ipcMain.handle("get-training-sessions", async (_event, configPath) => {
    if (!configPath) return [];
    try {
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) return [];
      const files = fs.readdirSync(configDir).filter((f) => {
        try {
          return f.endsWith(".log") && /^\d{8}_\d{2}-\d{2}-\d{2}\.log$/.test(f);
        } catch {
          return false;
        }
      });
      const sessions = files.sort().reverse();
      return sessions.map((file) => {
        const logPath = path.join(configDir, file);
        const stats = fs.statSync(logPath);
        const id = file.replace(".log", "");
        return {
          id,
          path: logPath,
          timestamp: stats.birthtimeMs,
          hasLog: true
        };
      });
    } catch (e) {
      console.error("Failed to list training sessions:", e);
      return [];
    }
  });
  const RECENT_PROJECTS_FILE = path.join(app.getPath("userData"), "recent_projects.json");
  const loadRecentProjects = () => {
    try {
      if (fs.existsSync(RECENT_PROJECTS_FILE)) {
        const data = fs.readFileSync(RECENT_PROJECTS_FILE, "utf-8");
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error("Failed to load recent projects:", e);
    }
    return [];
  };
  const saveRecentProjects = (projects) => {
    try {
      fs.writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save recent projects:", e);
    }
  };
  const getVerifiedProjects = () => {
    let projects = loadRecentProjects();
    try {
      const { projectRoot } = resolveModelsRoot();
      const outputDir = path.join(projectRoot, "output");
      if (fs.existsSync(outputDir)) {
        const entries = fs.readdirSync(outputDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = path.join(outputDir, entry.name);
            const exists = projects.some((p) => path.relative(p.path, fullPath) === "");
            if (!exists) {
              projects.push({
                name: entry.name,
                path: fullPath,
                lastModified: fs.statSync(fullPath).mtime.toLocaleString()
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Error scanning output dir:", e);
    }
    const verifiedProjects = [];
    for (const p of projects) {
      if (fs.existsSync(p.path)) {
        try {
          const stat = fs.statSync(p.path);
          p.timestamp = stat.mtime.getTime();
          p.lastModified = stat.mtime.toLocaleString();
          verifiedProjects.push(p);
        } catch (e) {
          verifiedProjects.push(p);
        }
      }
    }
    verifiedProjects.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return verifiedProjects;
  };
  ipcMain.handle("get-recent-projects", async () => {
    return getVerifiedProjects();
  });
  ipcMain.handle("add-recent-project", async (_event, project) => {
    const projects = loadRecentProjects();
    const filtered = projects.filter((p) => p.path.toLowerCase() !== project.path.toLowerCase());
    filtered.unshift(project);
    const limited = filtered.slice(0, 20);
    saveRecentProjects(limited);
    return getVerifiedProjects();
  });
  ipcMain.handle("remove-recent-project", async (_event, projectPath) => {
    const projects = loadRecentProjects();
    const filtered = projects.filter((p) => p.path.toLowerCase() !== projectPath.toLowerCase());
    saveRecentProjects(filtered);
    return getVerifiedProjects();
  });
  ipcMain.handle("delete-project-folder", async (_event, projectPath) => {
    try {
      const projects = loadRecentProjects();
      const filtered = projects.filter((p) => p.path.toLowerCase() !== projectPath.toLowerCase());
      saveRecentProjects(filtered);
      if (fs.existsSync(projectPath)) {
        await fs.promises.rm(projectPath, { recursive: true, force: true });
        return { success: true, projects: getVerifiedProjects() };
      } else {
        return { success: false, error: "Path does not exist", projects: getVerifiedProjects() };
      }
    } catch (error) {
      console.error(`Failed to delete project folder: ${projectPath}`, error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle("rename-project-folder", async (_event, { oldPath, newName }) => {
    try {
      if (!fs.existsSync(oldPath)) {
        return { success: false, error: "Path does not exist" };
      }
      const parentDir = path.dirname(oldPath);
      const newPath = path.join(parentDir, newName);
      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        return { success: false, error: "Target name already exists" };
      }
      fs.renameSync(oldPath, newPath);
      let projects = loadRecentProjects();
      let updated = false;
      projects = projects.map((p) => {
        if (p.path.toLowerCase() === oldPath.toLowerCase()) {
          updated = true;
          return {
            ...p,
            name: newName,
            path: newPath,
            lastModified: (/* @__PURE__ */ new Date()).toLocaleString()
          };
        }
        return p;
      });
      if (updated) {
        saveRecentProjects(projects);
      }
      return { success: true, newPath, projects: getVerifiedProjects() };
    } catch (error) {
      console.error(`Failed to rename project folder: ${oldPath}`, error);
      return { success: false, error: error.message };
    }
  });
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
