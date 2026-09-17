(function (root) {
  "use strict";

  const cases = [
    {
      order: 12,
      name: "Chess opening spaced repetition",
      file: "chess-opening-srs.html",
      storageKeys: ["appsToMake.chessOpeningSrs.v1"],
      run: async (t) => {
        t.equal(t.eval("parseFen(seeds[0].fen).length"), 64, "FEN expands to 64 squares");
        t.equal(t.id("board").children.length, 64, "board renders 64 squares");
        t.equal(t.eval("normalize('0-0+?!')"), "o-o", "move normalization handles castling annotations");
        t.eval("$('moveInput').value=current.move");
        t.click("checkBtn");
        t.matches(t.id("answerBox").textContent, /Correct/, "correct repertoire move is recognized");
        const review = t.eval("(() => { const card=current; grade('good'); return {interval:card.interval,reviews:card.reviews,future:card.due>Date.now()}; })()");
        t.deepEqual(review, { interval: 1, reviews: 1, future: true }, "good grade schedules the card");
      }
    },
    {
      order: 13,
      name: "Optical latitude and longitude locator",
      file: "optical-lat-long.html",
      run: async (t) => {
        t.equal(t.eval("norm180(540)"), -180, "longitude normalization wraps to -180");
        t.equal(t.eval("norm360(-10)"), 350, "azimuth normalization wraps positive");
        const terms = t.eval("solarTerms(new Date('2024-06-20T18:00:00Z'))");
        t.ok(Number.isFinite(terms.eq) && Number.isFinite(terms.decl), "solar terms are finite");
        const solved = t.eval(`(() => {
          const date=new Date('2024-06-20T18:00:00Z'), lat=37.87, lon=-122.27;
          const {eq,decl}=solarTerms(date), phi=rad(lat), utc=18*60;
          const greenwichH=utc/4+eq/4-180, H=rad(lon+greenwichH);
          const alt=Math.asin(Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(H));
          const sinA=-Math.cos(decl)*Math.sin(H)/Math.cos(alt);
          const cosA=(Math.cos(phi)*Math.sin(decl)-Math.sin(phi)*Math.cos(decl)*Math.cos(H))/Math.cos(alt);
          return solvePosition(deg(alt),norm360(deg(Math.atan2(sinA,cosA))),date);
        })()`);
        t.near(solved.lat, 37.87, 0.001, "inverse solar geometry recovers latitude");
        t.near(solved.lon, -122.27, 0.001, "inverse solar geometry recovers longitude");
        const observation = t.eval("observation()");
        t.ok(Number.isFinite(observation.alt) && Number.isFinite(observation.az), "calibrated image observation is finite");
      }
    },
    {
      order: 14,
      name: "Polytopia move search",
      file: "polytopia-move-search.html",
      storageKeys: ["appsToMake.polytopiaMove.v1"],
      run: async (t) => {
        t.deepEqual(t.eval("neighbors(0)"), [1, 9], "corner has two orthogonal neighbors");
        t.equal(t.eval("neighbors(40).length"), 4, "interior tile has four neighbors");
        t.eval("grid=Array.from({length:N*N},()=>({terrain:'plain',road:false})); unit=40; target=42; enemies=new Set(); $('movement').value=2; search()");
        t.near(t.eval("reachable.get(42).cost"), 2, 1e-9, "search finds a two-step target");
        t.deepEqual(t.eval("path"), [40, 41, 42], "search reconstructs the shortest path");
        t.eval("grid[41].terrain='mountain'; $('climb').checked=false");
        t.equal(t.eval("stepCost(41)"), Infinity, "mountain blocks units without climbing");
        t.eval("$('climb').checked=true; grid[41].road=true");
        t.near(t.eval("stepCost(41)"), 0.5, 1e-9, "roads override terrain movement cost");
      }
    },
    {
      order: 15,
      name: "Tendon evidence desk",
      file: "tendon-research.html",
      storageKeys: ["appsToMake.tendonEvidence.v1"],
      run: async (t) => {
        t.eval(`studies=[
          {id:'a',title:'Achilles loading',population:'Runners',tendon:'Achilles',intervention:'Isometric',duration:'12 weeks',outcome:'Stiffness',effect:'positive',estimate:'+10%',quality:'High',notes:''},
          {id:'b',title:'Patellar trial',population:'Jumpers',tendon:'Patellar',intervention:'Eccentric',duration:'8 weeks',outcome:'Pain',effect:'neutral',estimate:'0',quality:'Medium',notes:''}
        ]; render()`);
        t.equal(t.id("count").textContent, "2", "evidence rows render");
        t.deepEqual(t.eval("unique('tendon')"), ["Achilles", "Patellar"], "filter values are deduplicated");
        t.input("query", "achilles");
        t.equal(t.id("count").textContent, "1", "full-text filter narrows records");
        t.input("query", "");
        t.input("quality", "High");
        t.equal(t.id("count").textContent, "1", "quality filter narrows records");
        t.input("quality", "");
        t.click("add");
        t.input("title", "New collagen study");
        t.input("pop", "Adults");
        t.input("ten", "Achilles");
        t.input("outcome", "CSA");
        t.id("form").dispatchEvent(new t.win.Event("submit", { bubbles: true, cancelable: true }));
        t.equal(t.eval("studies.length"), 3, "form submission persists a new study");
      }
    },
    {
      order: 16,
      name: "Kepler and Brahe research timeline",
      file: "kepler-brahe-research.html",
      storageKeys: ["appsToMake.keplerBraheNotes.v1"],
      run: async (t) => {
        t.equal(t.eval("events.length"), 8, "timeline includes eight research milestones");
        t.equal(t.id("timeline").querySelectorAll(".event").length, 8, "all milestones render");
        t.click('[data-filter="brahe"]');
        t.equal(t.id("timeline").querySelectorAll(".event").length, 5, "Brahe filter includes Brahe and handoff events");
        t.click(t.id("timeline").querySelector(".event"));
        t.equal(t.id("title").textContent, "The new star", "timeline selection updates the detail panel");
        t.input("notes", "Check the primary-source translation.");
        t.equal(t.eval("notes[1572]"), "Check the primary-source translation.", "event notes persist in model state");
      }
    },
    {
      order: 18,
      name: "Lunisolar calendar",
      file: "lunisolar-calendar.html",
      run: async (t) => {
        t.equal(t.eval("mod(-1,29)"), 28, "phase modulus handles negative dates");
        t.equal(t.eval("dayOfYear(new Date(2024,0,1))"), 1, "solar-year day count starts at one");
        t.equal(t.id("calendar").children.length, 49, "calendar renders weekdays plus six weeks");
        const before = t.id("month").textContent;
        t.click("next");
        t.ok(t.id("month").textContent !== before, "month navigation advances the calendar");
        t.eval("cursor=new Date(2024,0,1); select(new Date(2024,0,1))");
        t.matches(t.id("age").textContent, /^\d+\.\dd$/, "selected date reports lunar age");
        t.equal(t.id("calendar").querySelectorAll(".selected").length, 1, "selected date is highlighted once");
        t.ok(t.eval("Array.from($('phaseBig').getContext('2d').getImageData(0,0,140,140).data).some((v,i)=>i%4===3&&v>0)"), "moon phase canvas contains visible pixels");
      }
    },
    {
      order: 19,
      name: "Antikythera dial bench",
      file: "antikythera.html",
      run: async (t) => {
        t.eval("rotate('sunHand',0.5,350,350)");
        t.equal(t.id("sunHand").getAttribute("transform"), "rotate(180 350 350)", "gear helper converts turns to degrees");
        t.input("days", "365");
        const solarRotation = Number(t.id("sunHand").getAttribute("transform").match(/rotate\(([-\d.]+)/)[1]);
        t.near(solarRotation, 365 / 365.2422 * 360, 1e-9, "solar hand follows the year gear ratio");
        t.equal(t.id("dayValue").textContent, "365 d", "day readout follows the slider");
        t.click("play");
        t.equal(t.id("play").textContent, "Pause crank", "crank starts animation");
        t.click("play");
        t.equal(t.id("play").textContent, "Turn crank", "crank stops animation");
      }
    },
    {
      order: 21,
      name: "Rhythm practice browser trainer",
      file: "rhythm-practice.html",
      run: async (t) => {
        const initial = t.eval("settings()");
        t.equal(t.id("trackA").querySelectorAll(".beat").length, initial.a, "upper lane renders its pulse count");
        t.equal(t.id("trackB").querySelectorAll(".beat").length, initial.b, "lower lane renders its pulse count");
        t.click('[data-mode="tuplet"]');
        t.equal(t.id("trackB").querySelectorAll(".beat").length, initial.cycle, "tuplet mode uses quarter-note references");
        t.matches(t.id("formula").textContent, / in /, "tuplet formula is displayed");
        t.input("a", "5");
        t.equal(t.id("trackA").querySelectorAll(".beat").length, 5, "pulse slider redraws the upper lane");
        t.eval("taps=[performance.now()-500]");
        t.click("tap");
        t.equal(t.id("bpm").value, "120", "tap tempo estimates 120 BPM from 500 ms");
        t.click("muteA");
        t.equal(t.eval("muted.a"), true, "upper lane mute toggles model state");
      }
    },
    {
      order: 22,
      name: "Accelerometer strobe",
      file: "accelerometer-strobe.html",
      run: async (t) => {
        t.equal(t.id("mode").querySelectorAll("button").length, 3, "all strobe modes render");
        t.input("freq", "7.26");
        t.equal(t.id("freqLabel").textContent, "7.3 Hz", "frequency label rounds consistently");
        t.eval("lastMotionT=performance.now()-1000; onMotion({acceleration:{x:3,y:4,z:0}})");
        t.deepEqual([t.id("x").textContent, t.id("y").textContent, t.id("z").textContent], ["3.00", "4.00", "0.00"], "motion event updates all axes");
        t.ok(Number.isFinite(Number(t.id("jerk").textContent)), "jerk estimate remains finite");
        t.click('[data-mode="accel"]');
        t.equal(t.eval("mode"), "accel", "mode control updates strobe model");
        t.click("zero");
        t.eval("lastMotionT=performance.now()-1000; onMotion({acceleration:{x:3,y:4,z:0}})");
        t.deepEqual([t.id("x").textContent, t.id("y").textContent], ["0.00", "0.00"], "zero baseline removes constant acceleration");
      }
    },
    {
      order: 23,
      name: "Location history",
      file: "location-history.html",
      run: async (t) => {
        t.near(t.eval("hav({lat:0,lon:0},{lat:0,lon:1})"), 111194.9, 2, "haversine distance matches one equatorial degree");
        const metrics = t.eval("metrics({started:0,points:[{lat:0,lon:0,t:0},{lat:0,lon:1,t:65000}]})");
        t.near(metrics.distance, 111194.9, 2, "track metrics sum segment distance");
        t.equal(metrics.duration, 65000, "track metrics compute duration");
        t.equal(t.eval("fmtDuration(65000)"), "1:05", "duration formatting uses minute-second notation");
        t.equal(t.eval("fmtDistance(1500)"), "1.50 km", "distance formatting changes to kilometers");
        t.equal(t.eval("escapeHtml('<b>x</b>')"), "&lt;b&gt;x&lt;/b&gt;", "session labels are HTML escaped");
        await t.waitFor(() => t.eval("!!db"), "IndexedDB opens successfully");
      }
    },
    {
      order: 26,
      name: "Sliding-puzzle graph diameter",
      file: "fifteen-puzzle-diameter.html",
      run: async (t) => {
        t.equal(t.eval("factorial(6)"), 720n, "factorial uses exact BigInt arithmetic");
        t.input("size", "3,2", "change");
        t.matches(t.id("scale").textContent, /360/, "3 by 2 parity class has 360 states");
        t.click("run");
        await t.waitFor(() => t.id("status").textContent === "Every reachable state discovered.", "worker completes exact BFS", 8000);
        t.equal(t.id("states").textContent, "360", "BFS visits every reachable state");
        t.equal(t.id("diameter").textContent, "21", "3 by 2 puzzle diameter is 21");
        t.equal(t.id("largest").textContent, "44", "largest BFS layer has 44 states");
        t.input("size", "4,4", "change");
        t.equal(t.id("run").disabled, true, "infeasible 4 by 4 exact search is guarded");
      }
    },
    {
      order: 28,
      name: "Procedural feline walk",
      file: "procedural-feline-walk.html",
      run: async (t) => {
        t.equal(t.eval("legs.length"), 4, "four procedural legs are built");
        const geometry = t.eval("(() => { const k=ik(0,0,100,0,false); return [Math.hypot(k.x,k.y),Math.hypot(100-k.x,-k.y)]; })()");
        t.near(geometry[0], 94, 0.001, "upper leg preserves its segment length");
        t.near(geometry[1], 98, 0.001, "lower leg preserves its segment length");
        t.click("play");
        t.equal(t.eval("playing"), false, "animation can pause");
        t.click('[data-gait="trot"]');
        t.equal(t.eval("gait"), "trot", "gait selector updates the gait model");
        t.input("stride", "120");
        t.equal(t.id("strideOut").textContent, "120", "stride control updates its readout");
        t.click("reset");
        t.equal(t.eval("phase"), 0, "reset returns animation phase to zero");
      }
    },
    {
      order: 29,
      name: "Edge-tone simulator",
      file: "edge-tone-simulator.html",
      run: async (t) => {
        const initial = t.eval("params()");
        t.near(initial.f, t.eval("ST[mode]*params().speed/params().d"), 1e-9, "Strouhal model computes edge-tone frequency");
        t.matches(t.eval("pitchName(440)"), /^A4 \+0/, "pitch formatter identifies concert A");
        t.input("speed", "20");
        t.equal(t.id("speedOut").textContent, "20.0 m/s", "jet speed readout updates");
        t.equal(t.id("frequency").textContent, String(Math.round(t.eval("params().f"))), "frequency display follows model parameters");
        t.click('[data-mode="2"]');
        t.equal(t.eval("mode"), 2, "register selector changes edge-tone stage");
        t.near(t.eval("params().f"), 0.8 * 20 / t.eval("params().d"), 1e-9, "higher register uses the selected Strouhal number");
      }
    },
    {
      order: 30,
      name: "Rubik group lab",
      file: "rubiks-group-lab.html",
      run: async (t) => {
        t.deepEqual(t.eval("parse(\"R U2 F'\")"), ["R", "U2", "F'"], "move parser handles turns, doubles, and inverses");
        t.deepEqual(t.eval("inverseTokens(['R','U2',\"F'\"])"), ["F", "U2", "R'"], "sequence inverse reverses and inverts moves");
        t.ok(t.eval("(() => { const start=[...state], seq=parse('R U F2'); applyTokens(seq,false); applyTokens(inverseTokens(seq),false); return state.every((x,i)=>x===start[i]); })()"), "sequence followed by inverse restores identity");
        const info = t.eval("(() => { state=[0,1,2,3,4,5,6,7]; applyTokens(['R'],false); return cycleInfo(); })()");
        t.equal(info.order, 4, "quarter turn has order four in corner permutation");
        t.equal(info.parity, "odd", "quarter-turn corner cycle has odd permutation parity");
        t.ok(t.eval("(() => { applyTokens(['R','R','R'],false); return state.every((x,i)=>x===i); })()"), "four quarter turns return to identity");
      }
    },
    {
      order: 31,
      name: "Itemized receipt logger",
      file: "receipt-logger.html",
      storageKeys: ["appsToMake.receipts.v1"],
      run: async (t) => {
        t.deepEqual(t.eval("totals({items:[{qty:2,price:3},{qty:1,price:4}],tax:2})"), { subtotal: 10, tax: 2, total: 12 }, "receipt totals combine quantity, price, and tax");
        t.click("new");
        t.input("store", "Test Market");
        t.input("date", new Date().toISOString().slice(0, 10));
        const row = t.id("items").children[0];
        row.querySelector(".iname").value = "Apples";
        row.querySelector(".iqty").value = "2";
        row.querySelector(".iprice").value = "5";
        t.input("tax", "2");
        t.input("printed", "12");
        t.eval("updateCheck()");
        t.ok(t.id("check").classList.contains("good"), "printed total reconciles with calculated total");
        t.equal(t.eval("draftItems()[0].name"), "Apples", "line-item editor serializes named items");
        t.id("form").dispatchEvent(new t.win.Event("submit", { bubbles: true, cancelable: true }));
        t.equal(t.eval("data.length"), 1, "receipt form adds one persisted receipt");
        t.equal(t.id("receiptCount").textContent, "1", "saved receipt appears in current month");
      }
    },
    {
      order: 32,
      name: "Doomsday weekday practice",
      file: "doomsday-practice.html",
      storageKeys: ["appsToMake.doomsday.v1"],
      run: async (t) => {
        t.equal(t.eval("leap(2000)"), true, "year 2000 is a leap year");
        t.equal(t.eval("leap(1900)"), false, "year 1900 is not a leap year");
        t.equal(t.eval("answer(1969,7,20).weekday"), 0, "Apollo 11 landing date resolves to Sunday");
        t.equal(t.eval("answer(2024,2,29).weekday"), 4, "2024 leap day resolves to Thursday");
        t.input("from", "2024");
        t.input("to", "2024");
        t.id("includeRecent").checked = false;
        t.equal(t.eval("randomDate().y"), 2024, "question generator respects year bounds");
        t.eval("target={y:1969,m:7,d:20}; started=performance.now(); stats={correct:0,streak:0,best:0}");
        t.eval("choose(0,$('weekdays').children[0])");
        t.equal(t.eval("stats.correct"), 1, "correct weekday updates score");
        t.ok(!t.id("breakdown").classList.contains("hidden"), "answer reveals calculation breakdown");
      }
    },
    {
      order: 33,
      name: "Matchmaking stopping rule",
      file: "matchmaking-stopping.html",
      run: async (t) => {
        t.equal(t.eval("choose([5,1,2],1)"), 2, "strategy falls back to final candidate");
        t.equal(t.eval("choose([1,5,4],1)"), 1, "strategy accepts first post-sample record");
        const trial = t.eval("trial(20,7,'uniform')");
        t.equal(trial.values.length, 20, "trial draws the requested population");
        t.ok(trial.selected >= 0 && trial.selected < 20, "trial selects a valid candidate");
        t.input("n", "20");
        t.input("trials", "120");
        t.click("simulate");
        t.equal(t.eval("curve.length"), 20, "simulation evaluates every skip threshold");
        t.equal(t.id("run").children.length, 20, "single-run chart renders every candidate");
        t.matches(t.id("success").textContent, /^\d+\.\d%$/, "Monte Carlo success rate is displayed");
        t.ok(t.eval("Array.from({length:20},()=>drawValue('exponential')).every(x=>x>=0)"), "exponential distribution never draws negative values");
      }
    },
    {
      order: 34,
      name: "Better Pinyin",
      file: "better-pinyin.html",
      storageKeys: ["appsToMake.betterPinyin.v1"],
      run: async (t) => {
        t.equal(t.eval("markSyllable('shui3')"), "shu\u01d0", "tone mark lands on final vowel when required");
        t.equal(t.eval("markSyllable('nv3')"), "n\u01da", "v input converts to marked u-diaeresis");
        t.equal(t.eval("convert('ni3 hao3')"), "n\u01d0 h\u01ceo", "numbered Pinyin converts to diacritics");
        t.input("input", "ma1 ma2 ma3 ma4 ma5");
        t.equal(t.id("contours").children.length, 5, "composer renders one contour per tone token");
        t.input("answer", t.eval("cards[index][2]"));
        t.click("check");
        t.ok(t.id("feedback").classList.contains("good"), "practice accepts the correct numbered answer");
        t.equal(t.eval("stats.correct"), 1, "correct answer increments score");
        const before = t.id("hanzi").textContent;
        t.click("next");
        t.ok(t.id("hanzi").textContent !== before, "next advances the practice deck");
      }
    },
    {
      order: 35,
      name: "Tower of Hanoi",
      file: "hanoi.html",
      run: async (t) => {
        t.input("n", "3");
        t.deepEqual(t.eval("pegs.map(p=>p.length)"), [3, 0, 0], "reset places all disks on the first peg");
        t.equal(t.eval("(() => { const out=[]; plan(3,0,2,1,out); return out.length; })()"), 7, "optimal three-disk plan has seven moves");
        t.equal(t.eval("move(0,2)"), true, "smallest disk can move to an empty peg");
        t.equal(t.eval("move(0,2)"), false, "larger disk cannot cover a smaller disk");
        t.equal(t.eval("moves"), 1, "illegal move does not increment counter");
        t.click("undo");
        t.deepEqual(t.eval("pegs.map(p=>p.length)"), [3, 0, 0], "undo restores the prior state");
        const solved = t.eval("(() => { reset(); const out=[]; plan(3,0,2,1,out); out.forEach(([a,b])=>move(a,b)); return {pegs:pegs.map(p=>p.length),moves}; })()");
        t.deepEqual(solved, { pegs: [0, 0, 3], moves: 7 }, "optimal plan solves the puzzle in minimum moves");
      }
    },
    {
      order: 36,
      name: "Temperature conversion practice",
      file: "temperature-practice.html",
      storageKeys: ["appsToMake.temperaturePractice.v1"],
      run: async (t) => {
        t.equal(t.eval("dir='cf'; convert(0)"), 32, "zero Celsius converts to 32 Fahrenheit");
        t.equal(t.eval("dir='fc'; convert(32)"), 0, "32 Fahrenheit converts to zero Celsius");
        t.eval("dir='cf'; value=100; stats={right:0,streak:0,errors:[]}");
        t.input("answer", "212");
        t.click("check");
        t.equal(t.eval("stats.right"), 1, "exact conversion increments score");
        t.equal(t.eval("stats.streak"), 1, "exact conversion increments streak");
        t.matches(t.id("feedback").textContent, /Correct/, "correct-answer explanation is shown");
        t.eval("value=0");
        t.input("answer", "0");
        t.click("check");
        t.equal(t.eval("stats.streak"), 0, "incorrect conversion resets streak");
        t.matches(t.id("error").textContent, /\u00b0$/, "mean absolute error is displayed");
      }
    },
    {
      order: 37,
      name: "Street-view shortcut repetition",
      file: "streetview-shortcuts.html",
      storageKeys: ["appsToMake.streetShortcuts.v1"],
      run: async (t) => {
        t.eval(`deck=[{id:'x',origin:'Berkeley',destination:'Oakland',place:'Tunnel route',lat:37.8,lon:-122.2,heading:90,pitch:0,route:'Claremont to Broadway',due:0,interval:0,ease:2.5}]; pick(deck[0])`);
        t.equal(t.eval("due().length"), 1, "new shortcut card is immediately due");
        t.equal(t.id("destination").textContent, "Oakland", "card prompt renders destination");
        t.input("route", "Claremont");
        t.click("reveal");
        t.matches(t.id("answer").textContent, /Claremont to Broadway/, "reveal shows stored route");
        t.ok(!t.id("grades").classList.contains("hidden"), "reveal exposes scheduling grades");
        const schedule = t.eval("(() => { const card=current; grade('good'); return {interval:card.interval,future:card.due>Date.now()}; })()");
        t.deepEqual(schedule, { interval: 1, future: true }, "good grade schedules one-day interval");
        t.equal(t.eval("due().length"), 0, "scheduled card leaves due queue");
      }
    },
    {
      order: 38,
      name: "Juggling robot",
      file: "juggling-robot.html",
      run: async (t) => {
        const p = t.eval("params()");
        t.near(p.T, Math.sqrt(8 * p.h / p.g), 1e-9, "flight time follows ballistic equation");
        t.near(p.rate, p.n / p.T, 1e-9, "throw rate derives from balls and flight time");
        t.input("balls", "9");
        t.input("height", "2");
        t.ok(t.id("feasible").classList.contains("warn"), "demanding pattern triggers feasibility warning");
        t.equal(t.id("ballsOut").textContent, "9", "ball-count readout updates");
        t.click("pause");
        t.equal(t.eval("playing"), false, "simulation pauses");
        t.equal(t.id("pause").textContent, "Resume", "pause control changes affordance");
        t.click("pause");
        t.equal(t.eval("playing"), true, "simulation resumes");
      }
    },
    {
      order: 39,
      name: "Ergonomic key-layout solver",
      file: "erg-key-solver.html",
      run: async (t) => {
        t.equal(t.eval("noteName(60)"), "C4", "MIDI note 60 formats as middle C");
        t.deepEqual(t.eval("parseText('C4 C#4 Eb4 69')"), [60, 61, 63, 69], "text parser handles names, accidentals, and MIDI numbers");
        const midi = t.eval(`parseMidi(new Uint8Array([
          77,84,104,100,0,0,0,6,0,0,0,1,0,96,
          77,84,114,107,0,0,0,12,0,144,60,64,96,128,60,64,0,255,47,0
        ]).buffer)`);
        t.deepEqual(midi, [60], "standard MIDI parser extracts note-on attacks");
        t.equal(t.eval("positions(60,5,2,3).cells.length"), 6, "layout generator creates rows times columns keys");
        t.eval("$('rows').value=4; $('cols').value=10; setSequence([60,64,67,72]); solve()");
        t.equal(t.id("coverage").textContent, "100%", "solver finds a layout covering the sequence");
        t.ok(Number.isFinite(Number(t.id("travel").textContent)), "solver reports finite average finger travel");
        t.equal(t.id("keyboard").querySelectorAll(".key").length, 40, "solved keyboard renders every key");
      }
    },
    {
      order: 40,
      name: "Science-fiction text-to-screen lag",
      file: "scifi-text-screen-lag.html",
      storageKeys: ["appsToMake.scifiLag.v1"],
      run: async (t) => {
        t.equal(t.eval("median([1,9,3])"), 3, "median handles odd sample counts");
        t.equal(t.eval("median([1,9,3,5])"), 4, "median averages an even middle pair");
        t.eval(`data=[
          {id:'a',screen:'Film A',screenYear:2000,concept:'X',book:'Book A',bookYear:1990,author:'A',relation:'equivalent',confidence:'high',source:'',notes:''},
          {id:'b',screen:'Film B',screenYear:2010,concept:'Y',book:'Book B',bookYear:2000,author:'B',relation:'adaptation',confidence:'high',source:'',notes:''},
          {id:'c',screen:'Film C',screenYear:2020,concept:'Z',book:'Book C',bookYear:2005,author:'C',relation:'equivalent',confidence:'medium',source:'',notes:''}
        ]; render()`);
        t.equal(t.id("mean").textContent, "11.7 y", "mean lag is calculated from visible rows");
        t.equal(t.id("median").textContent, "10.0 y", "median lag is calculated from visible rows");
        t.input("filter", "adaptation");
        t.equal(t.eval("visible().length"), 1, "relationship filter narrows pairings");
        t.input("filter", "");
        t.input("query", "film c");
        t.equal(t.eval("visible().length"), 1, "full-text search narrows pairings");
        t.input("query", "");
        t.click("add");
        t.input("screen", "Film D");
        t.input("screenYear", "2025");
        t.input("concept", "W");
        t.input("book", "Book D");
        t.input("bookYear", "2015");
        t.id("form").dispatchEvent(new t.win.Event("submit", { bubbles: true, cancelable: true }));
        t.equal(t.eval("data.length"), 4, "form adds a sourced comparison record");
      }
    },
    {
      order: 41,
      name: "Violin simulator",
      file: "violin-simulator.html",
      run: async (t) => {
        t.equal(t.eval("noteName(60)"), "C4", "MIDI note name formatter identifies middle C");
        t.near(t.eval("frequency(69)"), 440, 1e-9, "A4 frequency is 440 Hz");
        t.near(t.eval("frequency(81)"), 880, 1e-9, "frequency doubles after one octave");
        t.equal(t.id("keyboard").querySelectorAll("[data-note]").length, 24, "two-octave piano renders 24 chromatic keys");
        t.input("pressure", "0.65");
        t.equal(t.id("pressureOut").textContent, "65%", "bow-pressure readout updates");
        t.input("position", "0.8");
        t.equal(t.id("positionOut").textContent, "near bridge", "bow-position label maps high values to bridge");
        t.eval("voices=new Map([[60,{}]]); renderHeld()");
        t.equal(t.id("held").textContent, "C4", "held-note display follows active voices");
        t.ok(t.doc.querySelector('[data-note="60"]').classList.contains("active"), "active voice highlights its piano key");
        t.eval("voices.clear(); renderHeld()");
      }
    }
  ];

  root.APP_BROWSER_TEST_CASES = cases;
  if (typeof module === "object" && module.exports) module.exports = cases;
}(globalThis));
