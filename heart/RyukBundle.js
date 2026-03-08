import * as THREE from 'three';
import * as OrbitControlsModule from 'three/examples/jsm/controls/OrbitControls.js';
import * as STLExporterModule from 'three/examples/jsm/exporters/STLExporter.js';

// Explicitly use everything to prevent tree shaking
window.THREE = THREE;
window.OrbitControls = OrbitControlsModule.OrbitControls;
window.STLExporter = STLExporterModule.STLExporter;