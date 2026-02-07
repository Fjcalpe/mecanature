import * as THREE from 'three';

// --- 1. GENERADOR DE TEXTURAS ---
function createParticleTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 64, 64);

    if (type === 'glow') {
        const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
        g.addColorStop(0, 'rgba(255,255,255,1)'); 
        g.addColorStop(0.2, 'rgba(255,255,255,0.8)'); 
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    } else if (type === 'hardCircle') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'smoke') {
        const g = ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); 
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// --- 2. CLASE CAPA (LAYER) ---
class ParticleLayer {
    constructor(system, config) {
        this.system = system;
        this.config = {
            id: Date.now() + Math.random(),
            enabled: true,
            genType: config.genType || 'glow',
            genColor: config.genColor || '#ffffff',
            blendMode: config.blendMode || 'add',
            sourceType: config.sourceType || 'generator', 
            imageSrc: config.imageSrc || null,
            emissionRate: config.emissionRate || 20,
            life: { min: config.life?.min ?? 0.5, max: config.life?.max ?? 1.0 },
            speed: { value: config.speed?.value ?? 1, random: config.speed?.random ?? 0.5 },
            scale: { start: config.scale?.start ?? 0.5, end: config.scale?.end ?? 0 },
            alpha: { start: config.alpha?.start ?? 1, end: config.alpha?.end ?? 0 },
            gravity: { x: config.gravity?.x ?? 0, y: config.gravity?.y ?? 0 },
            globalOpacity: config.globalOpacity ?? 1,
            spawnRadius: config.spawnRadius ?? 0.3
        };

        this.particles = [];
        this.pool = [];
        this.currentTextureSrc = null; 
        
        this.material = new THREE.SpriteMaterial({
            map: null, 
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: this.config.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
            color: new THREE.Color(this.config.genColor),
            rotation: 0 // Rotación siempre 0
        });

        this.refreshTexture(true); 

        this.spawnTimer = 0;
        this.previousEmitterPosition = new THREE.Vector3();
        this.hasMoved = false;
    }

    refreshTexture(force = false) {
        if (this.config.sourceType === 'image' && this.config.imageSrc) {
            if (!force && this.config.imageSrc === this.currentTextureSrc) return;

            const loader = new THREE.TextureLoader();
            loader.load(
                this.config.imageSrc, 
                (tex) => {
                    if (this.material.map) this.material.map.dispose();
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false; 
                    this.material.map = tex;
                    this.material.rotation = 0; // Asegurar rotación 0 al cargar imagen
                    this.material.needsUpdate = true; 
                    this.currentTextureSrc = this.config.imageSrc;
                },
                undefined,
                () => {
                    this.config.sourceType = 'generator';
                    this.refreshTexture(true);
                }
            );
        } else {
            if (this.material.map) this.material.map.dispose();
            this.material.map = createParticleTexture(this.config.genType);
            this.material.rotation = 0; // Asegurar rotación 0
            this.material.needsUpdate = true;
            this.currentTextureSrc = null;
        }
    }

    updateConfig(newConfig) {
        const oldSourceType = this.config.sourceType;
        const oldGenType = this.config.genType;
        const oldImageSrc = this.config.imageSrc;
        
        this.config = { ...this.config, ...newConfig };

        if (newConfig.blendMode) {
            this.material.blending = this.config.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
            this.material.needsUpdate = true;
        }
        
        if (newConfig.genColor) {
            this.material.color.set(newConfig.genColor);
        }

        const sourceChanged = (this.config.sourceType !== oldSourceType);
        const genTypeChanged = (this.config.genType !== oldGenType);
        const imageChanged = (newConfig.imageSrc && newConfig.imageSrc !== oldImageSrc);

        if (sourceChanged || genTypeChanged || imageChanged) {
            this.refreshTexture();
        }
    }

    update(dt, emitterPos, isEmitting) {
        if(!this.config.enabled) return;

        const safeDt = Math.min(dt, 0.1);

        if(!this.hasMoved) {
            this.previousEmitterPosition.copy(emitterPos);
            this.hasMoved = true;
        }

        if (isEmitting) {
            const rate = this.config.emissionRate;
            const interval = 1.0 / rate;
            this.spawnTimer += safeDt;

            const count = Math.floor(this.spawnTimer / interval);
            if (count > 0) {
                const startPos = this.previousEmitterPosition;
                const endPos = emitterPos;
                
                for (let i = 0; i < count; i++) {
                    this.spawnTimer -= interval;
                    const t = (i + 1) / count; 
                    const interpPos = new THREE.Vector3().lerpVectors(startPos, endPos, t);
                    this.spawnParticle(interpPos);
                }
            }
        }

        this.previousEmitterPosition.copy(emitterPos);

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            p.age += safeDt;
            if (p.age >= p.life) {
                this.killParticle(i);
                continue;
            }

            const t = p.age / p.life;

            p.velocity.y += this.config.gravity.y * safeDt;
            p.mesh.position.addScaledVector(p.velocity, safeDt);

            const currentScale = this.config.scale.start * (1 - t) + this.config.scale.end * t;
            p.mesh.scale.setScalar(currentScale);

            const currentAlpha = (this.config.alpha.start * (1 - t) + this.config.alpha.end * t) * this.config.globalOpacity;
            p.mesh.material.opacity = currentAlpha;
        }
    }

    spawnParticle(position) {
        let p;
        if(this.pool.length > 0) {
            p = this.pool.pop();
            p.mesh.visible = true;
        } else {
            p = { mesh: new THREE.Sprite(this.material), velocity: new THREE.Vector3() };
            this.system.container.add(p.mesh);
        }

        p.age = 0;
        p.life = this.config.life.min + Math.random() * (this.config.life.max - this.config.life.min);
        p.mesh.position.copy(position);

        const r = this.config.spawnRadius;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const dist = Math.random() * r;
        p.mesh.position.x += dist * Math.sin(phi) * Math.cos(theta);
        p.mesh.position.y += dist * Math.sin(phi) * Math.sin(theta);
        p.mesh.position.z += dist * Math.cos(phi);

        const baseSpd = this.config.speed.value; 
        const randSpd = this.config.speed.random;
        const spd = (baseSpd + Math.random() * randSpd); 
        const vTheta = Math.random() * Math.PI * 2;
        const vPhi = Math.acos(2 * Math.random() - 1);
        p.velocity.set(
            Math.sin(vPhi) * Math.cos(vTheta) * spd,
            Math.sin(vPhi) * Math.sin(vTheta) * spd,
            Math.cos(vPhi) * spd
        );

        // CORRECCIÓN: Eliminada la rotación aleatoria para que los PNGs no giren
        p.mesh.material.rotation = 0; 
        
        p.mesh.scale.setScalar(this.config.scale.start);
        p.mesh.material = this.material; 

        this.particles.push(p);
    }

    killParticle(index) {
        const p = this.particles[index];
        p.mesh.visible = false;
        this.pool.push(p);
        this.particles.splice(index, 1);
    }

    dispose() {
        this.particles.forEach(p => this.system.container.remove(p.mesh));
        this.pool.forEach(p => this.system.container.remove(p.mesh));
        this.material.dispose();
        if(this.material.map) this.material.map.dispose();
    }
}

// --- 3. SISTEMA PRINCIPAL ---
export class ParticleSystem3D {
    constructor(scene, initialConfig) {
        this.scene = scene;
        this.container = new THREE.Group();
        this.scene.add(this.container);
        
        this.layers = [];
        this.emitting = false;
        this.emitterPosition = new THREE.Vector3();

        if(initialConfig) {
            this.addLayer(initialConfig);
        }
    }

    addLayer(config) {
        const layer = new ParticleLayer(this, config || {});
        this.layers.push(layer);
        return layer;
    }

    removeLayer(index) {
        if(index >= 0 && index < this.layers.length) {
            const layer = this.layers[index];
            layer.dispose();
            this.layers.splice(index, 1);
        }
    }

    importConfig(data) {
        while(this.layers.length > 0) this.removeLayer(0);
        const layersData = data.layers || [data];
        layersData.forEach(cfg => this.addLayer(cfg));
    }

    start() { this.emitting = true; }
    stop() { this.emitting = false; }
    
    setPosition(pos) { 
        this.emitterPosition.copy(pos); 
    }

    update(dt) {
        this.layers.forEach(layer => {
            layer.update(dt, this.emitterPosition, this.emitting);
        });
    }

    dispose() {
        this.layers.forEach(l => l.dispose());
        this.scene.remove(this.container);
    }
}