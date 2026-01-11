import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();

// --- 1. GENERADOR DE TEXTURAS ---
function createParticleTexture(type, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const color = colorHex || '#ffffff';

    if (type === 'glow') {
        const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
        g.addColorStop(0, color);
        g.addColorStop(0.2, color); 
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    } else if (type === 'hardCircle') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'smoke') {
        const g = ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
        g.addColorStop(0, color); 
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// --- 2. PARTÍCULA 3D ---
class Particle3D {
    constructor(parentSystem) {
        this.system = parentSystem;
        this.mesh = new THREE.Sprite(this.system.material);
        this.active = false;
    }

    spawn(position) {
        const cfg = this.system.config;
        this.active = true;
        this.age = 0;
        this.life = cfg.life.min + Math.random() * (cfg.life.max - cfg.life.min);
        
        // Usamos la posición interpolada que nos pasan
        this.mesh.position.copy(position);
        
        const r = cfg.spawnRadius || 0.3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const dist = Math.random() * r;

        this.mesh.position.x += dist * Math.sin(phi) * Math.cos(theta);
        this.mesh.position.y += dist * Math.sin(phi) * Math.sin(theta);
        this.mesh.position.z += dist * Math.cos(phi);

        const baseSpd = cfg.speed.value || 1; 
        const randSpd = cfg.speed.random || 0;
        const spd = (baseSpd + Math.random() * randSpd); 

        const vTheta = Math.random() * Math.PI * 2;
        const vPhi = Math.acos(2 * Math.random() - 1);
        
        this.velocity = new THREE.Vector3(
            Math.sin(vPhi) * Math.cos(vTheta) * spd,
            Math.sin(vPhi) * Math.sin(vTheta) * spd,
            Math.cos(vPhi) * spd
        );

        this.scaleStart = cfg.scale.start;
        this.scaleEnd = cfg.scale.end;
        
        this.mesh.scale.setScalar(this.scaleStart);
        this.mesh.material.opacity = cfg.alpha.start;
        this.mesh.material.rotation = Math.random() * Math.PI * 2;

        this.mesh.visible = true;
        this.system.container.add(this.mesh);
    }

    update(dt) {
        if (!this.active) return;
        this.age += dt;
        if (this.age >= this.life) {
            this.active = false;
            this.mesh.visible = false;
            this.system.container.remove(this.mesh);
            return;
        }

        const cfg = this.system.config;
        const t = this.age / this.life;

        this.velocity.y += cfg.gravity.y * dt;
        this.mesh.position.addScaledVector(this.velocity, dt);

        const currentScale = this.scaleStart * (1 - t) + this.scaleEnd * t;
        this.mesh.scale.setScalar(currentScale);

        const currentAlpha = (cfg.alpha.start * (1 - t) + cfg.alpha.end * t) * cfg.globalOpacity;
        this.mesh.material.opacity = currentAlpha;
    }
}

// --- 3. SISTEMA DE GESTIÓN ---
export class ParticleSystem3D {
    constructor(scene, config) {
        this.scene = scene;
        this.config = config || {
            globalOpacity: 1,
            emissionRate: 30,
            life: { min: 0.5, max: 1.0 },
            speed: { value: 1.5, random: 0.5 },
            scale: { start: 0.8, end: 0 },
            alpha: { start: 1, end: 0 },
            gravity: { x: 0, y: 2 }, 
            sourceType: 'generator', 
            genType: 'glow',
            genColor: '#00ffff'
        };

        this.particles = [];
        this.pool = [];
        this.container = new THREE.Group();
        this.scene.add(this.container);

        this.material = new THREE.SpriteMaterial({
            map: createParticleTexture('glow', '#ffffff'),
            transparent: true,
            opacity: 1,
            depthWrite: false,          
            blending: THREE.AdditiveBlending, 
            toneMapped: false,          
            fog: false                  
        });

        this.spawnTimer = 0;
        this.emitting = false;
        this.emitterPosition = new THREE.Vector3();
        this.previousEmitterPosition = new THREE.Vector3(); // Para interpolar
        this.hasMoved = false;
    }

    importPixiConfig(pixiData) {
        const P2M = 0.015; 
        const layer = Array.isArray(pixiData) ? pixiData[0] : (pixiData.layers ? pixiData.layers[0] : null);
        if(!layer) return;

        const c = layer.config;
        const s = layer.source;
        
        const newConfig = {
            sourceType: s.type || 'generator',
            genType: s.genType || 'glow',
            genColor: s.genColor || '#ffffff',
            imageSrc: s.imageSrc, 
            emissionRate: c.emissionRate || 20,
            life: { min: c.life.min, max: c.life.max },
            speed: { 
                value: (c.speed.value || 0) * P2M, 
                random: (c.speed.random || 0) * P2M 
            },
            scale: { start: c.scale.start * 0.5, end: c.scale.end * 0.5 },
            alpha: { start: c.alpha.start, end: c.alpha.end },
            gravity: { x: 0, y: (c.gravity.y || 0) * -P2M },
            globalOpacity: c.globalOpacity || 1,
            blendMode: c.blendMode || 'add' 
        };

        this.updateConfig(newConfig);
    }

    start() { this.emitting = true; }
    stop() { this.emitting = false; }
    
    setPosition(pos) { 
        if(!this.hasMoved) {
            this.previousEmitterPosition.copy(pos);
            this.hasMoved = true;
        } else {
            this.previousEmitterPosition.copy(this.emitterPosition);
        }
        this.emitterPosition.copy(pos); 
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Aplicar Blending
        if (this.config.blendMode === 'normal') {
            this.material.blending = THREE.NormalBlending;
        } else {
            this.material.blending = THREE.AdditiveBlending; 
        }

        // Aplicar Textura (IMAGEN o GENERADA)
        if (this.config.sourceType === 'image' && this.config.imageSrc) {
            // Verificar si es Base64 o URL
            const loader = new THREE.TextureLoader();
            loader.load(
                this.config.imageSrc, 
                (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    this.material.map = tex;
                    
                    // Si usamos imagen, generalmente queremos el color blanco base
                    // para que el tinte funcione, o el color del tinte.
                    if(newConfig.genColor) this.material.color.set(newConfig.genColor);
                    else this.material.color.set(0xffffff);
                    
                    this.material.needsUpdate = true;
                },
                undefined,
                (err) => console.error("Error cargando textura partícula", err)
            );
        } else {
            // Generador
            this.material.map = createParticleTexture(
                this.config.genType || 'glow', 
                '#ffffff' 
            );
            
            if(newConfig.genColor) this.material.color.set(newConfig.genColor);
            this.material.needsUpdate = true;
        }
    }

    update(dt) {
        // Limitar dt para evitar saltos enormes si el navegador se cuelga
        const safeDt = Math.min(dt, 0.1);

        if (this.emitting) {
            const rate = this.config.emissionRate || 20;
            const interval = 1.0 / rate;
            this.spawnTimer += safeDt;
            
            // --- INTERPOLACIÓN PARA SUAVIDAD ---
            // En lugar de spawnear todas en el punto actual, las repartimos
            // a lo largo del camino que hizo el orbe en este frame.
            
            const count = Math.floor(this.spawnTimer / interval);
            if (count > 0) {
                const startPos = this.previousEmitterPosition;
                const endPos = this.emitterPosition;
                
                for (let i = 0; i < count; i++) {
                    this.spawnTimer -= interval;
                    // Calcular posición intermedia (Lerp)
                    // Si spawneamos 3 partículas, las ponemos al 33%, 66% y 100% del recorrido
                    const t = (i + 1) / count; 
                    const interpPos = new THREE.Vector3().lerpVectors(startPos, endPos, t);
                    this.spawnParticle(interpPos);
                }
            }
        }
        
        // Actualizar posición previa para el siguiente frame
        this.previousEmitterPosition.copy(this.emitterPosition);

        // Actualizar existentes
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (p.active) p.update(safeDt);
            else { this.pool.push(p); this.particles.splice(i, 1); }
        }
    }

    spawnParticle(position) {
        let p = this.pool.length > 0 ? this.pool.pop() : new Particle3D(this);
        // Usar la posición interpolada si existe, sino la actual
        p.spawn(position || this.emitterPosition);
        this.particles.push(p);
    }
    
    dispose() {
        this.scene.remove(this.container);
        this.material.dispose();
        this.material.map.dispose();
    }
}