/**
 * Three.js renderer for the associator view: instanced soft particles (additive) + one bloom pass.
 * All brightness flows through ParticleField.exposure, which the flash limiter controls.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ParticleField } from './particles';

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

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.7, 0.18);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
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
    this.material.uniforms.uExposure.value = field.exposure;
    this.material.uniforms.uTime.value = reducedMotion ? 0 : timeSec;
    // Reduced motion: softer, wider glow instead of crisp shapes.
    this.bloom.radius = reducedMotion ? 0.95 : 0.7;
    this.bloom.strength = 0.5 * field.exposure;
    const [r, gg, b] = field.background;
    this.renderer.setClearColor(new THREE.Color(toLinear(r), toLinear(gg), toLinear(b)), 1);
    this.composer.render();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
