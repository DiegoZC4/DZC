The unmodified `mpg123-decoder` 1.0.3 and `@wasm-audio-decoders/flac` 0.2.12
browser bundles are from [wasm-audio-decoders](https://github.com/eshaz/wasm-audio-decoders).
Their source and build instructions, including submodules, are available at
[the MPEG revision](https://github.com/eshaz/wasm-audio-decoders/tree/8f2428c1cd96b54dab74836c8471ff75fe35cbee)
and [the FLAC revision](https://github.com/eshaz/wasm-audio-decoders/tree/8f41ee11e769951eeefe56e56ed5080994d3b02d).
The bundles can be replaced independently of the player.

The decoding libraries have separate notices:
[libmpg123](LICENSE-stream-mpg123.txt) and [libFLAC](LICENSE-stream-flac.txt).
The FLAC bundle includes [codec-parser 2.5.0](https://github.com/eshaz/codec-parser/tree/7834ca161922cd58f5e627d75b7dcc45dcce7e58)
under the [LGPL v3 or later](LICENSE-stream-codec-parser-LICENSE.txt), incorporating the [GPL v3](LICENSE-stream-GPLv3.txt).
The bundles use [puff](LICENSE-stream-puff.h) from [zlib](https://github.com/madler/zlib/tree/master/contrib/puff)
to expand embedded WASM. The JavaScript code originating in wasm-audio-decoders
is under the MIT license:

Copyright 2021-2026 Ethan Halsall.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
