#define RHYTHM_PRACTICE_NO_MAIN
#include "../rhythm-practice-cli/rhythm_practice.cpp"

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
int assertions = 0;

void expect(bool condition, const std::string& message) {
  ++assertions;
  if (!condition) throw std::runtime_error(message);
}

void expect_near(double actual, double expected, double tolerance, const std::string& message) {
  expect(std::abs(actual - expected) <= tolerance, message);
}

Options parse(std::vector<std::string> args) {
  std::vector<char*> argv;
  argv.reserve(args.size());
  for (std::string& arg : args) argv.push_back(arg.data());
  return parse_options(static_cast<int>(argv.size()), argv.data());
}
}  // namespace

int main() {
  try {
    const Options parsed = parse({"rhythm", "--a", "5", "--b", "3", "--tempo", "120",
                                  "--cycle-beats", "4", "--cycles", "2", "--dry-run"});
    expect(parsed.upper == 5 && parsed.lower == 3, "pulse arguments should parse");
    expect_near(parsed.bpm, 120.0, 1e-12, "tempo should parse");
    expect(parsed.cycle_beats == 4 && parsed.cycles == 2 && parsed.dry_run,
           "cycle and dry-run options should parse");

    bool rejected = false;
    try {
      (void)parse({"rhythm", "--a", "65"});
    } catch (const std::runtime_error&) {
      rejected = true;
    }
    expect(rejected, "pulse counts above 64 should be rejected");

    Options poly;
    poly.upper = 3;
    poly.lower = 2;
    poly.bpm = 120;
    poly.cycle_beats = 2;
    poly.cycles = 1;
    const std::vector<Event> poly_events = make_events(poly);
    expect(poly_events.size() == 4, "3:2 cycle should merge to four distinct attacks");
    expect(poly_events[0].upper && poly_events[0].lower, "first attack should be shared");
    expect_near(poly_events[1].seconds, 1.0 / 3.0, 1e-9, "second upper attack time");
    expect(!poly_events[1].lower && poly_events[2].lower, "lanes should remain distinct");
    expect_near(poly_events.back().seconds, 2.0 / 3.0, 1e-9, "final 3:2 attack time");

    Options tuplet;
    tuplet.upper = 5;
    tuplet.tuplet = true;
    tuplet.cycle_beats = 4;
    tuplet.bpm = 120;
    tuplet.cycles = 1;
    const std::vector<Event> tuplet_events = make_events(tuplet);
    expect(tuplet_events.size() == 8, "5-in-4 should contain eight distinct attacks");
    expect_near(tuplet_events.front().seconds, 0.0, 1e-12, "tuplet starts at zero");
    expect_near(tuplet_events.back().seconds, 1.6, 1e-9, "last quintuplet attack is at 1.6 seconds");

    poly.cycles = 2;
    const std::vector<Event> repeated = make_events(poly);
    expect(repeated.size() == 8, "two 3:2 cycles should contain eight attacks");
    expect_near(repeated[4].seconds, 1.0, 1e-9, "second cycle starts after one second");

    std::cout << "rhythm-practice-cpp: " << assertions << " assertions passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "rhythm-practice-cpp test failure: " << error.what() << "\n";
    return 1;
  }
}
