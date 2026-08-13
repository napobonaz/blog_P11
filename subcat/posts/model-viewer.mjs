import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * Initialize an interactive three.js viewer inside `canvas`, loading the
 * model described by `files` (an array of File objects — one .obj or .fbx,
 * plus optional .mtl and texture images for OBJ).
 *
 * Used two ways:
 *  - In the editor: `files` are real File objects from a drag-and-drop.
 *  - In an exported post: a thin wrapper (emitted inline by
 *    buildViewerScriptTag) fetches real files from a `models/` folder and
 *    calls this same loader path with Response blobs standing in for Files.
 *
 * Returns { dispose(), setWireframe(bool) }.
 */
export async function initModelViewer(canvas, files){
  const nameOf = f => (f.name || '').toLowerCase();
  const main = files.find(f => nameOf(f).endsWith('.obj') || nameOf(f).endsWith('.fbx'));
  if(!main){
    throw new Error('No .obj or .fbx file found among the dropped files.');
  }
  const isObj = nameOf(main).endsWith('.obj');
  const mtl = files.find(f => nameOf(f).endsWith('.mtl'));
  const textures = files.filter(f => /\.(png|jpe?g)$/i.test(nameOf(f)));

  // Map every filename to a blob URL so relative references inside the
  // .obj/.mtl/.fbx (e.g. a texture filename) resolve to the dropped files
  // instead of a real network path.
  const urlMap = new Map();
  files.forEach(f => urlMap.set(f.name, URL.createObjectURL(f)));

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const base = url.split('/').pop().split('?')[0];
    return urlMap.get(base) || url;
  });

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / (canvas.height || 320), 0.01, 5000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const hemi = new THREE.HemisphereLight(0xffffff, 0x30302a, 1.1);
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(3, 5, 4);
  scene.add(hemi, dir);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  function resize(){
    const w = canvas.clientWidth || 600;
    const h = canvas.height || 320;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let root = null;

  function frameObject(obj){
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    const dist = Math.max(size.x, size.y, size.z, 0.01) * 1.8;
    camera.position.set(dist, dist * 0.6, dist);
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  async function load(){
    if(isObj){
      const objLoader = new OBJLoader(manager);
      if(mtl){
        const mtlLoader = new MTLLoader(manager);
        const materials = await mtlLoader.loadAsync(urlMap.get(mtl.name));
        materials.preload();
        objLoader.setMaterials(materials);
      }
      root = await objLoader.loadAsync(urlMap.get(main.name));
    } else {
      const fbxLoader = new FBXLoader(manager);
      root = await fbxLoader.loadAsync(urlMap.get(main.name));
    }
    scene.add(root);
    frameObject(root);
  }

  let raf = null;
  function animate(){
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  await load();
  animate();

  return {
    setWireframe(on){
      if(!root) return;
      root.traverse(o => {
        if(o.isMesh && o.material){
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.wireframe = on; });
        }
      });
    },
    dispose(){
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      urlMap.forEach(u => URL.revokeObjectURL(u));
      scene.traverse(o => {
        if(o.isMesh){
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => m?.dispose?.());
        }
      });
    }
  };
}

/**
 * Returns the HTML string (canvas + toggle button + inline module script)
 * to embed in an exported static post. It loads the model at runtime from
 * real relative paths (models/<filename>) rather than from dropped Files.
 */
export function buildViewerScriptTag(id, filenames, wireframeDefault){
  const fileListJs = JSON.stringify(filenames.map(n => 'models/' + n));
  return `
<div class="model-figure">
  <canvas id="${id}" class="model-canvas" height="360"></canvas>
  <div class="model-controls">
    <label><input type="checkbox" id="${id}-wireframe"${wireframeDefault ? ' checked' : ''}> Wireframe view</label>
    <span class="model-hint">Drag to orbit · scroll to zoom</span>
  </div>
</div>
<script type="module">
  import { initModelViewer } from './model-viewer.mjs';
  const files = await Promise.all(${fileListJs}.map(async (path) => {
    const res = await fetch(path);
    const blob = await res.blob();
    return new File([blob], path.split('/').pop());
  }));
  const canvas = document.getElementById('${id}');
  const handle = await initModelViewer(canvas, files);
  handle.setWireframe(${wireframeDefault ? 'true' : 'false'});
  document.getElementById('${id}-wireframe').addEventListener('change', (e) => handle.setWireframe(e.target.checked));
</script>`;
}
