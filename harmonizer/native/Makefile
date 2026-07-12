CXX := clang++
BREW_PREFIX ?= /opt/homebrew

CXXFLAGS := -std=c++17 -O0 -g -Wall -Wextra
CPPFLAGS := -I$(BREW_PREFIX)/include
LDFLAGS := -L$(BREW_PREFIX)/lib

MACOS_FRAMEWORKS := \
	-framework CoreAudio \
	-framework CoreMIDI \
	-framework CoreFoundation

COMMON_AUDIO_LIBS := -lportaudio -laubio -lrtmidi
STATIC_WEB_AUDIO_LIBS := \
	$(BREW_PREFIX)/opt/portaudio/lib/libportaudio.a \
	$(BREW_PREFIX)/opt/aubio/lib/libaubio.a \
	$(BREW_PREFIX)/opt/rubberband/lib/librubberband.a \
	$(BREW_PREFIX)/opt/libsamplerate/lib/libsamplerate.a

PORTABLE_FRAMEWORKS := \
	$(MACOS_FRAMEWORKS) \
	-framework AudioToolbox \
	-framework AudioUnit \
	-framework CoreServices \
	-framework Accelerate

.PHONY: all clean dev-world dev-midi dev-web test-pitch app-macos

all: harmonizer_world harmonizer harmonizer_web

harmonizer_world: harmonizer_world.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $< $(LDFLAGS) $(COMMON_AUDIO_LIBS) -lSDL2 $(MACOS_FRAMEWORKS) -o $@

harmonizer: harmonizer_midi.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $< $(LDFLAGS) $(COMMON_AUDIO_LIBS) -lrubberband -lpthread $(MACOS_FRAMEWORKS) -o $@

harmonizer_web: harmonizer_web.cpp harmonizer_rubberband_engine.hpp web/index.html
	$(CXX) $(CXXFLAGS) -O3 -DNDEBUG $(CPPFLAGS) harmonizer_web.cpp $(LDFLAGS) -lportaudio -laubio -lrubberband -lpthread -framework CoreAudio -framework CoreFoundation -o $@

harmonizer_web_portable: harmonizer_web.cpp harmonizer_rubberband_engine.hpp web/index.html
	$(CXX) $(CXXFLAGS) -O3 -DNDEBUG $(CPPFLAGS) harmonizer_web.cpp $(STATIC_WEB_AUDIO_LIBS) -lpthread $(PORTABLE_FRAMEWORKS) -o $@

app-macos: harmonizer_web_portable
	./scripts/build_macos_app.sh

pitch_analyzer: pitch_analyzer.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $< $(LDFLAGS) -laubio -o $@

watch_files_macos: scripts/watch_files_macos.cpp
	$(CXX) $(CXXFLAGS) $< -o $@

dev-world: harmonizer_world
	./scripts/dev_harmonizer.sh harmonizer_world harmonizer_world.cpp

dev-midi: harmonizer
	./scripts/dev_harmonizer.sh harmonizer harmonizer_midi.cpp

dev-web: harmonizer_web
	./scripts/dev_harmonizer.sh harmonizer_web harmonizer_web.cpp harmonizer_rubberband_engine.hpp web/index.html

test-pitch: pitch_analyzer
	./scripts/test_pitch_fixtures.sh

clean:
	rm -f harmonizer harmonizer_world harmonizer_web harmonizer_web_portable pitch_analyzer watch_files_macos
	rm -rf harmonizer.dSYM harmonizer_world.dSYM harmonizer_web.dSYM pitch_analyzer.dSYM
