# Homepage Curation

The homepage is a showcase list, not a directory. It should link only to the most impressive work: finished apps, polished trainers, strong visualizations, and selected writing. Older experiments and rough hand-built files stay available by direct URL, but they do not get front-page links until they are redesigned.

The front page also avoids emoji labels. Each showcased link has a small custom SVG mark that hints at the page's subject.

Homepage ordering lives in `homepage-manifest.json`. The `pages` array is the priority order; `visibilityCutoff` and each page's `visible` flag decide what is published on the front page. Older `art` and `science` ranks can live under each page's `sorts` field for later experiments.

`index.html` is generated from that manifest so the browser never flashes hidden draft pages before filtering them out. Use `HomepagePriority.html` to reorder/cut off pages, then press `Rebuild homepage`; the local PHP endpoint saves the manifest and runs `python3 tools/build_homepage.py`. The same Python command is the canonical manual fallback.

For a full ranked publication backlog, including local files found outside this repo, see `PUBLICATION_PRIORITY.md`.

## Published On The Homepage

These are the current front-page links, in roughly showcase order.

- `EarTraining.html` - flagship music app; broad functionality, polished interface, persistent settings and stats.
- `SheetMusic.html` - selected transcriptions with PDF and MuseScore downloads.
- `assets/audio/the-bohemian-end.mp3` - homepage audio card for The Bohemian End.
- `weightup.html` - full-featured lifting tracker with history, charts, settings, import/export, and coherent styling.
- `ToddleTime.html` - playful, distinctive, and intentionally designed.
- `youtube-transcripts/index.html` - useful search app with channel filters, search history, result controls, and a mature interface.
- `Sequences.html` - single-file Lighthaven Sequences hub with searchable texts, curriculum partitions, and reading group backlog/calendar.
- `https://www.lesswrong.com/posts/qyJAvbyFTbqaYdyLn/upper-bounds-on-tolerable-risk` - first LessWrong post; substantial standalone writing.
- `phonation_time.html` - substantive cross-language data visualization with filtering, charts, tooltips, and stats.
- `aminoDAG.html` - presentable molecular DAG with a clear visual purpose.
- `algCycles.html` - linked as Cubing Alg Cycles; specialized but substantial cube-algorithm graph interface.
- `tak.html` - handmade, functional board/game page; visible while it gets more polish.
- `soroban.html` - handmade abacus interaction; visible while it gets more polish.
- `Pixel Art.html` - handmade pixel editor; visible while it gets more polish.
- `DnDMapTool.html` - handmade D&D map tool with custom party icons; visible while it gets more polish.
- `heart/RyukEarrings.html` - linked as Parametric Heart; handmade generator, visible while it gets more polish.
- `shave.html` - handmade SVG generator/sketch; visible while it gets more polish.
- `StraightLineMission.html` - handmade straight-line mission planner; visible while it gets more polish.
- `cursor-demo.html` - cursor/interaction demo currently visible as a small experimental piece.

## In The Manifest But Hidden Until Polished

These already have homepage cards and backlog sort rankings, but their `pride` cells are blank until they clear the publication bar.

- `MusicLab.html` - strong consolidated instrument playground, but still needs more UI/visualization polish before publishing.
- `hebrew.html` - useful trainer with local fonts and saved stats, but not yet polished enough for the front page.
- `aurebesh.html` - BB-8 icon and trainer work are kept, but it needs more polish before returning to the front page.
- `seam carving/seamCarving.html` - technically interesting, but still needs performance/UI polish.
- `minotaurus.html` - substantial board editor/game tool, but not yet front-page polished.
- `Periodic Table/periodicTable.html` - AI-generated content needs quality review.

## Omitted From The Homepage

These files are intentionally not linked from `index.html`. They are not deleted.

- `Piano.html` - superseded by `MusicLab.html`.
- `Brass.html` - superseded by `MusicLab.html`.
- `Harmonica.html` - superseded by `MusicLab.html`.
- `Khaen.html` - superseded by `MusicLab.html`.
- `Steelpan.html` - superseded by `MusicLab.html`.
- `Scales.html` and `EDO.html` - overlapping tuning playgrounds; superseded by `MusicLab.html` unless their deeper theory UI is revived.
- `PerfectPitch.html` - mostly superseded by `EarTraining.html`.
- `Etudes.html` - interesting idea, but the UI is too bare.
- `IonizationEnergies.html` - clever but niche and visually underdeveloped.
- `chess.html` - experimental board-game engine rather than a polished page.
- `lifting.html` - superseded by `weightup.html`.
- `heart/familyPortrait.html` - support/side page, not a homepage feature.
- `Recumbent.mp4` - media asset rather than an HTML app.
- `Borromean Rings.html` - small generator, not polished enough.
- `triskelion.html` - neat artifact, but not enough of a finished page.
- `yinyang.html` - archived/secondary sketch.
- `hueSpacing.html` - semi-useful/redundant.
- `life_calendar_month_mark.html` - personal utility/prototype, not curated.
- `grammatology.html` - interesting, but the UI is still old-prototype quality.
- `1kwords.html` - functional converter, but too bare for the front page.
- `presidents.html` - useful, but the visual treatment is still raw.
- `initials.html` - homepage logo component, not a standalone feature.
- `youtube-transcripts/stats.html` and `youtube-transcripts/patches.html` - support pages reachable from transcript search, not separate homepage items.

## Best Redesign Candidates

The old pages with the most substance are `tak.html`, `soroban.html`, `DnDMapTool.html`, `seam carving/seamCarving.html`, and `heart/RyukEarrings.html`. They are now linked from the homepage as active redesign targets, but they still need real UI work before they should be considered polished showcase pieces.

## Proposed Transcription Archive

MIDI alone is not the best publication format. MIDI is excellent for browser playback and import into DAWs, but it loses notation intent: enharmonic spelling, voices, articulations, repeats, layout, instrument labels, and most engraving decisions. For each transcription worth posting, keep the editable source and publish a small web bundle:

- `score.mscz` - MuseScore source, if this is the working file.
- `score.musicxml` - main interchange/display format; better than MIDI for rendering notation on the website.
- `score.mid` - playback/import format.
- `score.pdf` or exported SVG pages - optional fallback for print-perfect display.
- `metadata.json` - title, composer/source performance, arranger/transcriber credit, rights/provenance note, and short description.

For the website, the cleanest viewer is probably MusicXML for score display plus MIDI for playback. A page can render MusicXML for notation and use the MIDI file for simple play/pause/seek, while still offering downloads of both. The legal/provenance filter should be stricter than the technical filter: publish only public-domain material, original arrangements, or transcriptions where you are comfortable with the copyright risk and attribution.

### Best Candidates Found Locally

These are the transcription/score files that look most worth turning into a public archive page or collection.

1. `/Users/diego/Desktop/Music/Jacob Collier  - When I Fall In Love.mscz` and `/Users/diego/Desktop/Music/Jacob Collier  - When I Fall In Love -  - The Henry Westons Sessions, Cheltenham Jazz Festival 2016 (Y4PyJ96A3Fk).musicxml` - strongest showcase candidate if this is your transcription; musically interesting, compact enough for a web score, and already has both MuseScore/MusicXML artifacts.
2. `/Users/diego/Documents/MuseScore4/Scores/When I Fall in Love.mscz` - likely related to the Jacob Collier transcription above; compare versions and keep the cleaner canonical source.
3. `/Users/diego/Desktop/Music/Blue_in_Green (condensed).mscz` and `/Users/diego/Desktop/Music/Blue_in_Green.mscz` - good jazz candidate; the condensed version sounds especially web-friendly because it can be presented as a readable study score instead of a huge dump.
4. `/Users/diego/Desktop/Music/Playing Love (edited).mscz` and `/Users/diego/Desktop/Music/Playing Love – The Legend of 1900 (transcription).mscz` - good cinematic transcription candidate; use the edited file as the source if it is cleaner.
5. `/Users/diego/Documents/MuseScore4/Scores/We'll Meet Again.mscz` and `/Users/diego/Music/We'll meet again performed on a Hammond Novachord built in 1939 (dMEuibX4c04).musicxml` - worth publishing if the MusicXML came from your transcription/cleanup; the Novachord angle gives it a stronger story than a generic score.
6. `/Users/diego/Documents/MuseScore4/Scores/Down in the River to Pray.mscz` - likely a good public-facing choral/folk candidate; check arrangement rights and export MusicXML/MIDI.
7. `/Users/diego/Documents/MuseScore4/Scores/Here And Heaven.mscz` - likely worth including if it is a real transcription/arrangement rather than a rough sketch.
8. `/Users/diego/Documents/MuseScore4/Scores/And So It Goes.mscz` - good compact song transcription candidate; publish after a copyright/provenance check.
9. `/Users/diego/Documents/MuseScore4/Scores/Top of the World.mscz` - reasonable songbook candidate, but less distinctive than the jazz/cinematic/transcription-heavy items above.
10. `/Users/diego/Documents/MuseScore4/Scores/Handlebars.mscz`, `/Users/diego/Documents/MuseScore4/Scores/Stromae.mscz`, and `/Users/diego/Documents/MuseScore4/Scores/Monsters Inc.mscz` - possible fun additions, but only after checking whether they are polished and actually yours to publish.
11. `/Users/diego/Documents/MuseScore4/Scores/Jazz Camp Marina/` - publish as a collection, not as separate homepage items. Candidates found: `Sun Sun Babae.mscz`, `Quien Sera.mscz`, `El Pescador.mscz`, `Popurri de Carnaval.mscz`, `Besame Mucho.mscz`, `Quizas Quizas Quizas.mscz`, and `Vuelan las Mariposas.mscz`.
12. `/Users/diego/Desktop/Music/Fantaisie-Impromptu in C♯ Minor – Chopin.mscz`, `/Users/diego/Desktop/Music/String Quartet No.2 – Aleksandr Borodin.mscz`, `/Users/diego/Desktop/Music/string-quartet-no2-aleksandr-borodin.mscz`, and `/Users/diego/Desktop/Music/Czardas.mscz` - lower priority as "transcriptions" unless these are original reductions/editions, but they are safer public-domain-ish score demos than most pop/jazz material.
13. `/Users/diego/Desktop/Music/Graceful Ghost Rag – William Bolcom.mscz` and `/Users/diego/Desktop/Music/Magic Waltz.mscz` - musically attractive, but treat as lower priority because they are likely copyrighted and may be less clearly original transcription work.

### Found But Probably Do Not Publish

- `/Users/diego/Documents/GitHub/VSKeys/midi/` - looks like a downloaded/practice MIDI bundle, not a personal transcription archive. Useful for testing a player, but not worth showcasing as your work.
- `/Users/diego/Desktop/Music/MIDI Renderer/` - test material for a renderer, not public-facing transcription content.
- `/Users/diego/Desktop/Music/Ear Training/soundfonts/GeneralUser/GeneralUser GS 1.471/demo MIDIs/` - third-party demo MIDIs bundled with the soundfont; do not publish as site content.
- `/Users/diego/Desktop/Music/superperm.mid`, `/Users/diego/Desktop/Music/SPEViolin.mid`, and `/Users/diego/Desktop/Mail/-heart.mid` - either generated/test/unclear provenance; not good transcription-archive candidates.

I also checked the obvious mounted backup locations under `/Volumes/Mac-Windows` and `/Volumes/Iris Backup`; the targeted score-format scan did not surface additional publishable transcription candidates there.
