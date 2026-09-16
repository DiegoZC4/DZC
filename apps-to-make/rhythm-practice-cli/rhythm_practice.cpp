#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

struct Options {
  double bpm = 90.0;
  int upper = 3;
  int lower = 2;
  int cycle_beats = 2;
  int cycles = 8;
  bool tuplet = false;
  bool bell = false;
  bool dry_run = false;
};

struct Event {
  double seconds;
  bool upper = false;
  bool lower = false;
};

[[noreturn]] void usage(const char* program, int code = 0) {
  std::ostream& out = code ? std::cerr : std::cout;
  out << "Usage:\n"
      << "  " << program << " --a 3 --b 2 --tempo 90 --cycle-beats 2\n"
      << "  " << program << " --tuplet 5 --in 4 --tempo 80\n\n"
      << "Options:\n"
      << "  --cycles N       Number of cycles (default 8)\n"
      << "  --bell           Emit a terminal bell on each attack\n"
      << "  --dry-run        Print timestamps without waiting\n";
  std::exit(code);
}

int read_int(const char* value, const std::string& name) {
  const int parsed = std::stoi(value);
  if (parsed <= 0) throw std::runtime_error(name + " must be positive");
  return parsed;
}

double read_double(const char* value, const std::string& name) {
  const double parsed = std::stod(value);
  if (!(parsed > 0.0)) throw std::runtime_error(name + " must be positive");
  return parsed;
}

Options parse_options(int argc, char** argv) {
  Options options;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto next = [&]() -> const char* {
      if (++i >= argc) throw std::runtime_error("missing value after " + arg);
      return argv[i];
    };
    if (arg == "--a") options.upper = read_int(next(), arg);
    else if (arg == "--b") options.lower = read_int(next(), arg);
    else if (arg == "--tuplet") {
      options.tuplet = true;
      options.upper = read_int(next(), arg);
    } else if (arg == "--in") options.cycle_beats = read_int(next(), arg);
    else if (arg == "--tempo" || arg == "--bpm") options.bpm = read_double(next(), arg);
    else if (arg == "--cycle-beats") options.cycle_beats = read_int(next(), arg);
    else if (arg == "--cycles") options.cycles = read_int(next(), arg);
    else if (arg == "--bell") options.bell = true;
    else if (arg == "--dry-run") options.dry_run = true;
    else if (arg == "--help" || arg == "-h") usage(argv[0]);
    else throw std::runtime_error("unknown option: " + arg);
  }
  if (options.upper > 64 || options.lower > 64 || options.cycle_beats > 64) {
    throw std::runtime_error("pulse counts above 64 are not supported in this draft");
  }
  return options;
}

std::vector<Event> make_events(const Options& options) {
  const double cycle_seconds = 60.0 / options.bpm * options.cycle_beats;
  const int lower_count = options.tuplet ? options.cycle_beats : options.lower;
  std::map<long long, Event> merged;

  for (int cycle = 0; cycle < options.cycles; ++cycle) {
    const double cycle_start = cycle * cycle_seconds;
    for (int pulse = 0; pulse < options.upper; ++pulse) {
      const double time = cycle_start + pulse * cycle_seconds / options.upper;
      const auto key = std::llround(time * 1'000'000.0);
      merged[key] = Event{time, true, merged[key].lower};
    }
    for (int pulse = 0; pulse < lower_count; ++pulse) {
      const double time = cycle_start + pulse * cycle_seconds / lower_count;
      const auto key = std::llround(time * 1'000'000.0);
      merged[key] = Event{time, merged[key].upper, true};
    }
  }

  std::vector<Event> events;
  events.reserve(merged.size());
  for (const auto& [_, event] : merged) events.push_back(event);
  return events;
}

void print_event(const Event& event, bool bell) {
  std::cout << "\r\033[2K" << std::fixed << std::setprecision(3) << std::setw(8)
            << event.seconds << " s  ";
  if (event.upper && event.lower) std::cout << "A+B  ●";
  else if (event.upper) std::cout << "A    ●";
  else std::cout << "B    ○";
  if (bell) std::cout << '\a';
  std::cout << std::flush;
}

#ifndef RHYTHM_PRACTICE_NO_MAIN
int main(int argc, char** argv) {
  try {
    const Options options = parse_options(argc, argv);
    const auto events = make_events(options);
    const auto start = std::chrono::steady_clock::now() + std::chrono::milliseconds(150);

    std::cout << (options.tuplet ? "Tuplet " : "Polyrhythm ") << options.upper
              << (options.tuplet ? " in " : " : ")
              << (options.tuplet ? options.cycle_beats : options.lower)
              << " at " << options.bpm << " BPM\n";

    for (const Event& event : events) {
      if (!options.dry_run) {
        const auto deadline = start + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                                          std::chrono::duration<double>(event.seconds));
        std::this_thread::sleep_until(deadline);
      }
      print_event(event, options.bell);
      if (options.dry_run) std::cout << '\n';
    }
    if (!options.dry_run) std::cout << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "rhythm_practice: " << error.what() << "\n";
    usage(argv[0], 2);
  }
}
#endif
