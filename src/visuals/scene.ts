/**
 * Three.js renderer for the associator view: instanced soft particles (additive) + one bloom pass.
 * All brightness flows through ParticleField.exposure, which the flash limiter controls.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SPARK_CAPACITY, STREAK_SECONDS, type ParticleField } from './particles';

const vertex = /* glsl */ `
  attribute vec3 iOffset;   // x, y, size
  attribute vec4 iColor;    // linear rgb, alpha
  attribute float iGrain;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vGrain;
  void main() {
    vUv = position.xy;
    vColor = iColor;
    vGrain = iGrain;
    vec3 p = vec3(iOffset.xy + position.xy * iOffset.z, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uExposure;
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vGrain;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float r = length(vUv) * 2.0;           // 0 at center, 1 at quad edge
    float a = exp(-r * r * 3.2);           // soft Gaussian falloff
    if (a < 0.003) discard;
    float g = mix(1.0, 0.65 + 0.7 * hash(gl_FragCoord.xy + floor(uTime * 12.0)), vGrain * 0.6);
    gl_FragColor = vec4(vColor.rgb * a * vColor.a * g * uExposure, 1.0);
  }
`;

/** Sparks: a sharp streak stretched along the direction of travel. */
const sparkVertex = /* glsl */ `
  attribute vec4 iSpark;    // x, y, vx, vy
  attribute vec4 iColor;    // linear rgb, alpha
  attribute float iSize;
  uniform float uStreak;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = position.xy;
    vColor = iColor;
    vec2 v = iSpark.zw;
    float speed = length(v);
    vec2 dir = speed > 1e-4 ? v / speed : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float len = iSize * 2.0 + speed * uStreak;
    // Tail trails behind the head: shift the quad backwards along the motion.
    vec2 p = iSpark.xy + dir * (position.x * len - len * 0.35) + nrm * position.y * iSize * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const sparkFragment = /* glsl */ `
  uniform float uExposure;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    // Bright head at the front, fading tail behind it; crisp across the width.
    float along = vUv.x + 0.5;               // 0 = tail end, 1 = head end
    float across = abs(vUv.y) * 2.0;
    float w = exp(-across * across * 6.0);
    float tail = smoothstep(0.0, 0.85, along) * (1.0 - smoothstep(0.9, 1.0, along) * 0.6);
    float a = w * tail;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * a * vColor.a * uExposure, 1.0);
  }
`;

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

export class AssociatorScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private mesh: THREE.Mesh;
  private offsets: THREE.InstancedBufferAttribute;
  private colors: THREE.InstancedBufferAttribute;
  private grains: THREE.InstancedBufferAttribute;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.InstancedBufferGeometry;
  private video: { el: HTMLVideoElement; mesh: THREE.Mesh; tex: THREE.VideoTexture } | null = null;
  private sparkGeometry: THREE.InstancedBufferGeometry;
  private sparkMaterial: THREE.ShaderMaterial;
  private sparkPos: THREE.InstancedBufferAttribute;
  private sparkColor: THREE.InstancedBufferAttribute;
  private sparkSize: THREE.InstancedBufferAttribute;
  aspect = 1;

  constructor(private canvas: HTMLCanvasElement, capacity: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    const base = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.grains = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iOffset', this.offsets);
    this.geometry.setAttribute('iColor', this.colors);
    this.geometry.setAttribute('iGrain', this.grains);
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uExposure: { value: 1 }, uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Sparks
    this.sparkGeometry = new THREE.InstancedBufferGeometry();
    this.sparkGeometry.index = base.index;
    this.sparkGeometry.setAttribute('position', base.getAttribute('position'));
    this.sparkPos = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sparkColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sparkSize = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
    this.sparkGeometry.setAttribute('iSpark', this.sparkPos);
    this.sparkGeometry.setAttribute('iColor', this.sparkColor);
    this.sparkGeometry.setAttribute('iSize', this.sparkSize);
    this.sparkGeometry.instanceCount = 0;
    this.sparkMaterial = new THREE.ShaderMaterial({
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      uniforms: { uExposure: { value: 1 }, uStreak: { value: STREAK_SECONDS } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const sparkMesh = new THREE.Mesh(this.sparkGeometry, this.sparkMaterial);
    sparkMesh.frustumCulled = false;
    sparkMesh.renderOrder = 1;
    this.scene.add(sparkMesh);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.7, 0.18);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  /**
   * Projector view: draw the live camera behind the particles, dimmed and mirrored. The frames are
   * only drawn to this canvas; they are never stored or sent anywhere.
   */
  setVideo(el: HTMLVideoElement | null) {
    if (this.video) {
      this.scene.remove(this.video.mesh);
      this.video.mesh.geometry.dispose();
      (this.video.mesh.material as THREE.Material).dispose();
      this.video.tex.dispose();
      this.video = null;
    }
    if (!el) return;
    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.3, 0.3, 0.3), depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.video = { el, mesh, tex };
    el.addEventListener('loadedmetadata', () => this.layoutVideo());
    this.layoutVideo();
  }

  private layoutVideo() {
    if (!this.video) return;
    const { el, mesh } = this.video;
    const va = el.videoWidth && el.videoHeight ? el.videoWidth / el.videoHeight : 4 / 3;
    // "Cover" the screen, cropping whichever side overflows; negative x mirrors like a selfie view.
    const w = va > this.aspect ? 2 * va : 2 * this.aspect;
    const h = va > this.aspect ? 2 : (2 * this.aspect) / va;
    mesh.scale.set(-w, h, 1);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.left = -this.aspect;
    this.camera.right = this.aspect;
    this.camera.updateProjectionMatrix();
    this.layoutVideo();
  }

  render(field: ParticleField, timeSec: number, reducedMotion: boolean) {
    let n = 0;
    const o = this.offsets.array as Float32Array;
    const c = this.colors.array as Float32Array;
    const g = this.grains.array as Float32Array;
    for (const p of field.particles) {
      if (!p.active || p.alpha <= 0.001) continue;
      o[n * 3] = p.x;
      o[n * 3 + 1] = p.y;
      o[n * 3 + 2] = p.size * 2; // quad spans the Gaussian's tails
      c[n * 4] = toLinear(p.rgb[0]);
      c[n * 4 + 1] = toLinear(p.rgb[1]);
      c[n * 4 + 2] = toLinear(p.rgb[2]);
      c[n * 4 + 3] = p.alpha;
      g[n] = p.grain;
      n++;
    }
    this.geometry.instanceCount = n;
    this.offsets.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.grains.needsUpdate = true;
    // Sparks
    const sp = field.sparks;
    const sPos = this.sparkPos.array as Float32Array;
    const sCol = this.sparkColor.array as Float32Array;
    const sSize = this.sparkSize.array as Float32Array;
    let m = 0;
    for (let i = 0; i < sp.n; i++) {
      if (!sp.active[i] || sp.alpha[i] <= 0.002) continue;
      sPos[m * 4] = sp.x[i];
      sPos[m * 4 + 1] = sp.y[i];
      sPos[m * 4 + 2] = sp.vx[i];
      sPos[m * 4 + 3] = sp.vy[i];
      sCol[m * 4] = toLinear(sp.rgb[i * 3]);
      sCol[m * 4 + 1] = toLinear(sp.rgb[i * 3 + 1]);
      sCol[m * 4 + 2] = toLinear(sp.rgb[i * 3 + 2]);
      sCol[m * 4 + 3] = sp.alpha[i];
      sSize[m] = sp.size[i];
      m++;
    }
    this.sparkGeometry.instanceCount = m;
    this.sparkPos.needsUpdate = true;
    this.sparkColor.needsUpdate = true;
    this.sparkSize.needsUpdate = true;
    this.sparkMaterial.uniforms.uExposure.value = field.exposure;

    this.material.uniforms.uExposure.value = field.exposure;
    this.material.uniforms.uTime.value = reducedMotion ? 0 : timeSec;
    // Reduced motion: softer, wider glow instead of crisp shapes.
    const fireworks = field.style === 'fireworks';
    this.bloom.radius = reducedMotion ? 0.95 : fireworks ? 0.45 : 0.7;
    this.bloom.threshold = fireworks ? 0.08 : 0.18;
    this.bloom.strength = (fireworks ? 0.9 : 0.5) * field.exposure;
    const [r, gg, b] = field.background;
    this.renderer.setClearColor(new THREE.Color(toLinear(r), toLinear(gg), toLinear(b)), 1);
    this.composer.render();
  }

  dispose() {
    this.setVideo(null);
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
