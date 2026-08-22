import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

function dataUrlToArrayBuffer(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1] || '';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function DocumentPreview({ file }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setHtml('');
    setError('');
    import('mammoth').then(({ default: mammoth }) => (
      mammoth.convertToHtml({ arrayBuffer: dataUrlToArrayBuffer(file.dataUrl) })
    )).then((result) => {
      if (!cancelled) setHtml(DOMPurify.sanitize(result.value));
    }).catch((previewError) => {
      if (!cancelled) setError(previewError?.message || 'Document preview failed.');
    });
    return () => { cancelled = true; };
  }, [file.dataUrl]);

  if (error) return <div className="desktop-preview-empty">{error}</div>;
  if (!html) return <div className="desktop-preview-empty">Rendering document…</div>;
  return <article className="desktop-document-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ModelPreview({ file }) {
  const hostRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let renderer;
    let animationFrame;
    let resizeObserver;
    let controls;
    const host = hostRef.current;
    if (!host) return undefined;
    setError('');

    Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/OBJLoader.js'),
      import('three/examples/jsm/loaders/STLLoader.js'),
    ]).then(([THREE, { OrbitControls }, { GLTFLoader }, { OBJLoader }, { STLLoader }]) => {
      if (disposed) return;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x01070b);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
      camera.position.set(2.8, 2.2, 3.4);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.replaceChildren(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      scene.add(new THREE.HemisphereLight(0xcffafe, 0x07131a, 2.4));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(4, 6, 3);
      scene.add(keyLight);
      const grid = new THREE.GridHelper(10, 20, 0x1b8f88, 0x0b3336);
      scene.add(grid);

      const fitObject = (object) => {
        scene.add(object);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);
        const radius = Math.max(size.x, size.y, size.z, 0.1);
        camera.position.set(radius * 1.7, radius * 1.25, radius * 2.1);
        camera.near = Math.max(radius / 1000, 0.001);
        camera.far = Math.max(radius * 100, 100);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
      };
      const fail = (loadError) => setError(loadError?.message || 'This 3D object could not be rendered.');
      if (file.extension === '.glb' || file.extension === '.gltf') {
        new GLTFLoader().load(file.dataUrl, (gltf) => fitObject(gltf.scene), undefined, fail);
      } else if (file.extension === '.obj') {
        try {
          const source = new TextDecoder().decode(dataUrlToArrayBuffer(file.dataUrl));
          fitObject(new OBJLoader().parse(source));
        } catch (loadError) { fail(loadError); }
      } else if (file.extension === '.stl') {
        try {
          const geometry = new STLLoader().parse(dataUrlToArrayBuffer(file.dataUrl));
          fitObject(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x67e8f9, roughness: 0.58, metalness: 0.12 })));
        } catch (loadError) { fail(loadError); }
      }

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      const render = () => {
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(render);
      };
      render();
    }).catch((previewError) => setError(previewError?.message || '3D preview is unavailable.'));

    return () => {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      controls?.dispose();
      renderer?.dispose();
      host.replaceChildren();
    };
  }, [file]);

  return (
    <div className="desktop-model-preview">
      <div ref={hostRef} className="desktop-model-canvas" />
      {error && <div className="desktop-preview-error">{error}</div>}
      {!error && <span className="desktop-preview-hint">Drag to orbit · Scroll to zoom</span>}
    </div>
  );
}

export default function WorkspaceFilePreview({ file }) {
  if (!file) return null;
  if (file.kind === 'image') return <div className="desktop-media-preview"><img src={file.dataUrl} alt={file.name} /></div>;
  if (file.kind === 'pdf') return <iframe className="desktop-pdf-preview" src={file.dataUrl} title={`PDF preview: ${file.name}`} />;
  if (file.kind === 'document') return <DocumentPreview file={file} />;
  if (file.kind === 'model') return <ModelPreview file={file} />;
  if (file.kind === 'video') return <div className="desktop-media-preview"><video src={file.dataUrl} controls aria-label={file.name} /></div>;
  if (file.kind === 'audio') return <div className="desktop-media-preview"><audio src={file.dataUrl} controls aria-label={file.name} /></div>;
  return <div className="desktop-preview-empty">No visual preview is available for {file.name}.</div>;
}
