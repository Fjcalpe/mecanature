import * as THREE from 'three';

export class InGameEditor {
    constructor(scene, camera, renderer, orbs) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.orbs = orbs; // Array de instancias OrbLogic
        this.visible = false;
        
        // Estado interno para arrastrar
        this.isDraggingOrb = false;
        this.dragPlane = new THREE.Plane();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Guardar estado original para restaurar al cerrar
        this.originalState = new Map();

        this.injectStyles();
        this.createUI();
        
        // Sincronizar con el primer orbe
        if(this.orbs.length > 0) this.syncUI();

        // Eventos globales para arrastrar el orbe
        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onMouseDown(e));
        this.renderer.domElement.addEventListener('pointermove', (e) => this.onMouseMove(e));
        this.renderer.domElement.addEventListener('pointerup', () => this.onMouseUp());
    }

    injectStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            #pe-toggle { 
                position: fixed; top: 10px; right: 120px; z-index: 1000; 
                background: #e91e63; color: white; border: none; padding: 8px 15px; 
                border-radius: 4px; cursor: pointer; font-weight: bold; font-family: monospace; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            }
            #pe-panel { 
                position: fixed; top: 0; right: 0; width: 320px; height: 100vh; 
                background: rgba(20, 20, 20, 0.95); border-left: 1px solid #444; 
                z-index: 2000; display: none; flex-direction: column; 
                color: #ccc; font-family: 'Segoe UI', sans-serif; font-size: 11px;
                backdrop-filter: blur(10px); box-shadow: -5px 0 15px rgba(0,0,0,0.5);
            }
            #pe-content { flex: 1; overflow-y: auto; padding: 15px; scrollbar-width: thin; }
            .pe-group { margin-bottom: 12px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; border: 1px solid #333; }
            .pe-label { display: block; color: #e91e63; font-weight: 800; margin-bottom: 8px; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
            .pe-row { display: flex; align-items: center; margin-bottom: 5px; gap: 8px; }
            .pe-row label { flex: 1; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .pe-row input[type=range] { flex: 2; cursor: pointer; accent-color: #e91e63; height: 4px; }
            .pe-row input[type=number] { width: 45px; background: #111; border: 1px solid #444; color: #00e5ff; text-align: right; padding: 2px; border-radius: 2px; }
            .pe-row select { flex: 2; background: #222; color: white; border: 1px solid #444; padding: 2px; }
            .pe-row input[type=color] { border: none; width: 30px; height: 20px; background: none; cursor: pointer; }
            .pe-btn-bar { padding: 10px; border-top: 1px solid #444; display: flex; gap: 5px; background: #1a1a1a; }
            .pe-btn { flex: 1; padding: 8px; border: none; border-radius: 3px; cursor: pointer; color: white; font-weight: bold; font-size: 10px; text-transform: uppercase; transition: filter 0.2s; }
            .pe-btn:hover { filter: brightness(1.2); }
            .pe-save { background: #2e7d32; } .pe-load { background: #1565c0; } .pe-reset { background: #c62828; }
        `;
        document.head.appendChild(style);
    }

    createUI() {
        const btn = document.createElement('button');
        btn.id = 'pe-toggle';
        btn.innerText = '✨ EDITOR';
        btn.onclick = () => this.toggleEditor();
        document.body.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = 'pe-panel';
        
        // --- BLOQUEO DE EVENTOS ---
        // Esto evita que al tocar el editor se mueva la cámara del juego
        ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'mousemove'].forEach(evt => {
            panel.addEventListener(evt, (e) => e.stopPropagation());
        });

        const content = document.createElement('div');
        content.id = 'pe-content';
        this.ui = {};

        // 1. SECCIÓN ORBE (GEOMETRÍA)
        content.appendChild(this.createGroup('Esfera & Material', [
            { type: 'range', id: 'orbRadius', label: 'Radio', min: 0.1, max: 2, step: 0.1 },
            { type: 'range', id: 'orbSeg', label: 'Polígonos', min: 4, max: 64, step: 1 },
            { type: 'color', id: 'orbColor', label: 'Color Base' },
            { type: 'color', id: 'orbEmissive', label: 'Emisivo' },
            { type: 'select', id: 'orbBlend', label: 'Mezcla', options: ['Normal', 'Additive'] }
        ]));

        // 2. SECCIÓN LUZ
        content.appendChild(this.createGroup('Luz Asociada', [
            { type: 'color', id: 'lightColor', label: 'Color Luz' },
            { type: 'range', id: 'lightInt', label: 'Intensidad', min: 0, max: 20, step: 0.1 },
            { type: 'range', id: 'lightDist', label: 'Alcance', min: 0, max: 50, step: 1 },
            { type: 'range', id: 'lightDecay', label: 'Decay', min: 0, max: 2, step: 0.1 }
        ]));

        // 3. SECCIÓN PARTÍCULAS
        content.appendChild(this.createGroup('Partículas: Apariencia', [
            { type: 'select', id: 'genType', label: 'Forma', options: ['glow','hardCircle','smoke'] },
            { type: 'color', id: 'genColor', label: 'Tinte' },
            { type: 'select', id: 'blendMode', label: 'Blending', options: ['add','normal'] },
            { type: 'file', id: 'imageSrc', label: 'Textura PNG' }
        ]));

        content.appendChild(this.createGroup('Partículas: Emisión', [
            { type: 'range', id: 'emissionRate', label: 'Cantidad/s', min: 1, max: 500, step: 1 },
            { type: 'range', id: 'spawnRadius', label: 'Radio Spawn', min: 0, max: 2, step: 0.1 }
        ]));

        content.appendChild(this.createGroup('Partículas: Física', [
            { type: 'range', id: 'speedVal', label: 'Velocidad', min: 0, max: 10, step: 0.1 },
            { type: 'range', id: 'speedRnd', label: 'Aleatorio', min: 0, max: 5, step: 0.1 },
            { type: 'range', id: 'gravityY', label: 'Gravedad Y', min: -10, max: 10, step: 0.1 },
            { type: 'range', id: 'lifeMin', label: 'Vida Min', min: 0.1, max: 5, step: 0.1 },
            { type: 'range', id: 'lifeMax', label: 'Vida Max', min: 0.1, max: 5, step: 0.1 }
        ]));

        content.appendChild(this.createGroup('Partículas: Evolución', [
            { type: 'range', id: 'scaleStart', label: 'Escala Ini', min: 0, max: 3, step: 0.1 },
            { type: 'range', id: 'scaleEnd', label: 'Escala Fin', min: 0, max: 3, step: 0.1 },
            { type: 'range', id: 'alphaStart', label: 'Alpha Ini', min: 0, max: 1, step: 0.05 },
            { type: 'range', id: 'alphaEnd', label: 'Alpha Fin', min: 0, max: 1, step: 0.05 },
            { type: 'range', id: 'globalOpacity', label: 'Opacidad', min: 0, max: 1, step: 0.05 }
        ]));

        panel.appendChild(content);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'pe-btn-bar';
        
        const btnReset = document.createElement('button');
        btnReset.className = 'pe-btn pe-reset';
        btnReset.innerText = 'RESET POS';
        btnReset.onclick = () => this.resetOrbPosition();

        const btnSave = document.createElement('button');
        btnSave.className = 'pe-btn pe-save';
        btnSave.innerText = 'GUARDAR';
        btnSave.onclick = () => this.exportJSON();

        const btnLoad = document.createElement('button');
        btnLoad.className = 'pe-btn pe-load';
        btnLoad.innerText = 'CARGAR';
        btnLoad.onclick = () => inpFile.click();

        const inpFile = document.createElement('input');
        inpFile.type = 'file'; inpFile.accept = '.json'; inpFile.style.display = 'none';
        inpFile.onchange = (e) => this.importJSON(e);

        footer.append(btnReset, btnLoad, btnSave);
        panel.appendChild(footer);
        panel.appendChild(inpFile);

        document.body.appendChild(panel);
    }

    createGroup(title, controls) {
        const group = document.createElement('div');
        group.className = 'pe-group';
        group.innerHTML = `<span class="pe-label">${title}</span>`;
        controls.forEach(c => {
            const row = document.createElement('div');
            row.className = 'pe-row';
            if (c.type === 'range') {
                row.innerHTML = `<label>${c.label}</label>`;
                const input = document.createElement('input');
                input.type = 'range'; input.min = c.min; input.max = c.max; input.step = c.step;
                const num = document.createElement('input');
                num.type = 'number'; num.step = c.step;
                const update = () => {
                    const val = parseFloat(input.value);
                    num.value = val;
                    this.updateValues(c.id, val);
                };
                input.oninput = update;
                num.onchange = () => { input.value = num.value; update(); };
                this.ui[c.id] = { input, num };
                row.append(input, num);
            } else if (c.type === 'select') {
                row.innerHTML = `<label>${c.label}</label>`;
                const sel = document.createElement('select');
                c.options.forEach(o => sel.innerHTML += `<option value="${o}">${o}</option>`);
                sel.onchange = () => this.updateValues(c.id, sel.value);
                this.ui[c.id] = { input: sel };
                row.appendChild(sel);
            } else if (c.type === 'color') {
                row.innerHTML = `<label>${c.label}</label>`;
                const col = document.createElement('input'); col.type = 'color';
                col.oninput = () => this.updateValues(c.id, col.value);
                this.ui[c.id] = { input: col };
                row.appendChild(col);
            } else if (c.type === 'file') {
                const btn = document.createElement('button');
                btn.innerText = '📁 PNG'; btn.className = 'pe-btn pe-load';
                const file = document.createElement('input');
                file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
                btn.onclick = () => file.click();
                file.onchange = (e) => {
                    const f = e.target.files[0]; if(!f) return;
                    const r = new FileReader();
                    r.onload = (evt) => {
                        this.updateValues('sourceType', 'image');
                        this.updateValues('imageSrc', evt.target.result);
                    };
                    r.readAsDataURL(f);
                };
                row.append(btn, file);
            }
            group.appendChild(row);
        });
        return group;
    }

    toggleEditor() {
        this.visible = !this.visible;
        const panel = document.getElementById('pe-panel');
        panel.style.display = this.visible ? 'flex' : 'none';

        if (this.visible && this.orbs.length > 0) {
            // AL ABRIR: Pausar IA del orbe y traerlo al frente
            const orb = this.orbs[0];
            orb.state = 'editor_mode'; // Modo especial para que no se mueva solo
            this.resetOrbPosition();
        } else {
            // AL CERRAR: Restaurar
            this.orbs.forEach(o => o.state = 'flying'); // O el estado que tuviera
        }
    }

    resetOrbPosition() {
        if(this.orbs.length === 0) return;
        // Colocar orbe frente a la cámara
        const targetPos = new THREE.Vector3(0, 0, -3).applyMatrix4(this.camera.matrixWorld);
        this.orbs.forEach((o, i) => {
            o.mesh.position.copy(targetPos);
            o.mesh.position.x += i * 1.0; // Separarlos un poco si hay varios
            o.velocity.set(0,0,0);
        });
    }

    syncUI() {
        // Sincronizar UI con el primer orbe
        const orb = this.orbs[0];
        const pCfg = orb.particles.config;
        const mesh = orb.mesh;
        const light = orb.light;

        const setVal = (id, v) => {
            if(!this.ui[id]) return;
            this.ui[id].input.value = v;
            if(this.ui[id].num) this.ui[id].num.value = v;
        };

        // Orbe
        setVal('orbRadius', mesh.geometry.parameters.radius);
        setVal('orbSeg', mesh.geometry.parameters.widthSegments);
        setVal('orbColor', '#' + mesh.material.color.getHexString());
        if(mesh.material.emissive) setVal('orbEmissive', '#' + mesh.material.emissive.getHexString());
        setVal('orbBlend', mesh.material.blending === THREE.AdditiveBlending ? 'Additive' : 'Normal');

        // Luz
        setVal('lightColor', '#' + light.color.getHexString());
        setVal('lightInt', light.intensity);
        setVal('lightDist', light.distance);
        setVal('lightDecay', light.decay);

        // Partículas
        setVal('genType', pCfg.genType);
        setVal('genColor', pCfg.genColor);
        setVal('blendMode', pCfg.blendMode || 'add');
        setVal('emissionRate', pCfg.emissionRate);
        setVal('spawnRadius', pCfg.spawnRadius);
        setVal('speedVal', pCfg.speed.value);
        setVal('speedRnd', pCfg.speed.random);
        setVal('gravityY', pCfg.gravity.y);
        setVal('lifeMin', pCfg.life.min);
        setVal('lifeMax', pCfg.life.max);
        setVal('scaleStart', pCfg.scale.start);
        setVal('scaleEnd', pCfg.scale.end);
        setVal('alphaStart', pCfg.alpha.start);
        setVal('alphaEnd', pCfg.alpha.end);
        setVal('globalOpacity', pCfg.globalOpacity);
    }

    updateValues(id, val) {
        this.orbs.forEach(orb => {
            // --- ACTUALIZAR PARTÍCULAS ---
            const updates = {};
            if(id === 'speedVal') updates.speed = { value: val };
            else if(id === 'speedRnd') updates.speed = { random: val };
            else if(id === 'lifeMin') updates.life = { min: val };
            else if(id === 'lifeMax') updates.life = { max: val };
            else if(id === 'scaleStart') updates.scale = { start: val };
            else if(id === 'scaleEnd') updates.scale = { end: val };
            else if(id === 'alphaStart') updates.alpha = { start: val };
            else if(id === 'alphaEnd') updates.alpha = { end: val };
            else if(id === 'gravityY') updates.gravity = { y: val };
            else updates[id] = val; // Genéricos (rate, radius, etc)

            // Mezclar configs anidados
            const pc = orb.particles.config;
            if(updates.speed) updates.speed = { ...pc.speed, ...updates.speed };
            if(updates.life) updates.life = { ...pc.life, ...updates.life };
            if(updates.scale) updates.scale = { ...pc.scale, ...updates.scale };
            if(updates.alpha) updates.alpha = { ...pc.alpha, ...updates.alpha };
            if(updates.gravity) updates.gravity = { ...pc.gravity, ...updates.gravity };
            
            // Si el ID pertenece a partículas, actualizar sistema
            if(Object.keys(this.ui).some(k => k === id && !k.startsWith('orb') && !k.startsWith('light'))) {
                orb.particles.updateConfig(updates);
            }

            // --- ACTUALIZAR ORBE (GEOMETRÍA Y MATERIAL) ---
            if(id.startsWith('orb')) {
                const m = orb.mesh;
                if(id === 'orbRadius' || id === 'orbSeg') {
                    // Regenerar geometría
                    const r = id==='orbRadius'?val:m.geometry.parameters.radius;
                    const s = id==='orbSeg'?val:m.geometry.parameters.widthSegments;
                    m.geometry.dispose();
                    m.geometry = new THREE.SphereGeometry(r, s, s);
                }
                if(id === 'orbColor') m.material.color.set(val);
                if(id === 'orbEmissive') m.material.emissive.set(val);
                if(id === 'orbBlend') {
                    m.material.blending = val === 'Additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
                    m.material.transparent = true;
                    m.material.needsUpdate = true;
                }
            }

            // --- ACTUALIZAR LUZ ---
            if(id.startsWith('light')) {
                const l = orb.light;
                if(id === 'lightColor') l.color.set(val);
                if(id === 'lightInt') l.intensity = val;
                if(id === 'lightDist') l.distance = val;
                if(id === 'lightDecay') l.decay = val;
            }
        });
    }

    // --- LOGICA DE ARRASTRE (RAYCASTER) ---
    onMouseDown(e) {
        if(!this.visible) return;
        this.updateMouse(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Comprobar si tocamos algún orbe
        const intersects = this.raycaster.intersectObjects(this.orbs.map(o => o.mesh));
        if(intersects.length > 0) {
            this.isDraggingOrb = true;
            this.selectedOrb = intersects[0].object; // El mesh
            // Preparamos plano de arrastre frente a la cámara
            this.dragPlane.setFromNormalAndCoplanarPoint(
                this.camera.getWorldDirection(new THREE.Vector3()),
                this.selectedOrb.position
            );
            // Bloquear controles de cámara (si OrbitControls estuviera activo, aquí no lo está pero por si acaso)
            e.preventDefault(); 
        }
    }

    onMouseMove(e) {
        if(!this.isDraggingOrb || !this.visible) return;
        this.updateMouse(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const target = new THREE.Vector3();
        if(this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
            this.selectedOrb.position.copy(target);
        }
    }

    onMouseUp() {
        this.isDraggingOrb = false;
        this.selectedOrb = null;
    }

    updateMouse(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    exportJSON() {
        if(this.orbs.length === 0) return;
        // Guardamos config de partículas y del orbe
        const orb = this.orbs[0];
        const data = {
            particles: orb.particles.config,
            orb: {
                radius: orb.mesh.geometry.parameters.radius,
                segments: orb.mesh.geometry.parameters.widthSegments,
                color: '#' + orb.mesh.material.color.getHexString(),
                emissive: '#' + orb.mesh.material.emissive.getHexString(),
                blend: orb.mesh.material.blending === THREE.AdditiveBlending ? 'Additive' : 'Normal'
            },
            light: {
                color: '#' + orb.light.color.getHexString(),
                intensity: orb.light.intensity,
                distance: orb.light.distance,
                decay: orb.light.decay
            }
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = "orb_design.json"; a.click();
    }

    importJSON(e) {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                // Cargar valores (usando updateValues para que se aplique visualmente)
                if(data.particles) this.orbs.forEach(o => o.particles.updateConfig(data.particles));
                
                if(data.orb) {
                    this.updateValues('orbRadius', data.orb.radius);
                    this.updateValues('orbSeg', data.orb.segments);
                    this.updateValues('orbColor', data.orb.color);
                    this.updateValues('orbEmissive', data.orb.emissive);
                    this.updateValues('orbBlend', data.orb.blend);
                }
                if(data.light) {
                    this.updateValues('lightColor', data.light.color);
                    this.updateValues('lightInt', data.light.intensity);
                    this.updateValues('lightDist', data.light.distance);
                    this.updateValues('lightDecay', data.light.decay);
                }
                
                this.syncUI(); // Refrescar sliders
            } catch(err) { alert("Error JSON"); }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
}