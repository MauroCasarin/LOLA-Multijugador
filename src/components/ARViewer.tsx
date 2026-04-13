import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { ARButton } from 'three/examples/jsm/webxr/ARButton';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
// @ts-ignore
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { Loader2, AlertCircle, Upload, Crosshair, Settings } from 'lucide-react';
import Joystick from './Joystick';
import { io, Socket } from 'socket.io-client';

// Raw URL to the GLB file on GitHub
const MODEL_URL = '/LOLA-GLB.glb';

const LASER_GEO = new THREE.CylinderGeometry(0.005, 0.005, 0.1, 8);
LASER_GEO.translate(0, 0.05, 0);
const LASER_MAT = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });

function createTextSprite(message: string) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite();
  
  canvas.width = 1024;
  canvas.height = 256;
  
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.fillRect(0, 0, 1024, 256);
  
  context.font = 'bold 120px sans-serif';
  context.fillStyle = 'white';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(message, 512, 128);
  
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.renderOrder = 999;
  return sprite;
}

function createIconItem(emoji: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return { group: new THREE.Group(), sprite: new THREE.Sprite() };
  
  context.font = '90px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  
  // Añadir un brillo suave detrás del emoji
  context.shadowColor = emoji === '⚡' ? 'rgba(255, 255, 0, 0.8)' : 'rgba(255, 0, 0, 0.8)';
  context.shadowBlur = 20;
  context.fillText(emoji, 64, 64);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.35, 0.35, 0.35); // Tamaño más grande
  sprite.renderOrder = 998;
  
  // Crear sombra en baja calidad (círculo)
  const shadowGeo = new THREE.CircleGeometry(0.15, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ 
    color: 0x000000, 
    transparent: true, 
    opacity: 0.4, 
    depthWrite: false 
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005; // Apenas por encima del piso
  
  const group = new THREE.Group();
  group.add(shadow);
  group.add(sprite);
  
  return { group, sprite };
}

interface ARViewerProps {
  roomId: string;
  playerName: string;
  playerColor: string;
}

export default function ARViewer({ roomId, playerName, playerColor }: ARViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carPlaced, setCarPlaced] = useState(false);
  const [modelSource, setModelSource] = useState<string | File | null>(MODEL_URL);
  const [scale, setScale] = useState(1);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [health, setHealth] = useState(100);
  const [isDead, setIsDead] = useState(false);
  const [hasDoubleShot, setHasDoubleShot] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [killerName, setKillerName] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{ targetName: string, shooterName: string | null } | null>(null);
  const [iocMode, setIocMode] = useState(false);
  
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const innerModelRef = useRef<THREE.Group | null>(null);
  const shadowMeshRef = useRef<THREE.Mesh | null>(null);
  const wheelsRef = useRef<THREE.Object3D[]>([]);
  const frontWheelsRef = useRef<THREE.Object3D[]>([]);
  const rearWheelsRef = useRef<THREE.Object3D[]>([]);
  const initialWheelRotY = useRef<Map<THREE.Object3D, number>>(new Map());
  const engineSoundRef = useRef<THREE.Audio | null>(null);
  const collisionSoundRef = useRef<THREE.Audio | null>(null);
  const brakingSoundRef = useRef<THREE.Audio | null>(null);
  const isPlacedRef = useRef(false);
  const joystickRef = useRef({ x: 0, y: 0 });
  const isJumpingRef = useRef(false);
  const jumpProgressRef = useRef(0);
  const distanceTraveledRef = useRef(0);
  const prevYRef = useRef(0);
  const initialPlacementRef = useRef<{ position: THREE.Vector3, quaternion: THREE.Quaternion } | null>(null);
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const speedMultiplierRef = useRef<number>(1);
  const velocityRef = useRef<number>(0);
  const angularVelocityRef = useRef<number>(0);
  const iocModeRef = useRef<boolean>(false);
  const socketRef = useRef<Socket | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  const modelTemplateRef = useRef<THREE.Group | null>(null);
  const remotePlayersRef = useRef<Map<string, THREE.Group>>(new Map());
  const playerNamesRef = useRef<Map<string, string>>(new Map());
  const lasersRef = useRef<{mesh: THREE.Mesh, life: number, dir: THREE.Vector3}[]>([]);
  const itemsRef = useRef<Map<string, { group: THREE.Group, sprite: THREE.Sprite, type: string, seed: number, serverX: number, serverZ: number }>>(new Map());

  const applyCarColor = (model: THREE.Object3D, colorHex: string) => {
    const color = new THREE.Color(colorHex);
    model.traverse((child: any) => {
      if (child.isMesh && child.material) {
        const hsl = { h: 0, s: 0, l: 0 };
        if (child.material.color) {
          child.material.color.getHSL(hsl);
          // Teñir solo si no es muy oscuro (para no pintar las llantas) y no es transparente (para no pintar los vidrios)
          if (hsl.l > 0.15 && child.material.opacity === 1 && !child.material.transparent) {
            child.material = child.material.clone();
            child.material.color.set(color);
          }
        }
      }
    });
  };

  const createLaserVisual = (pos: THREE.Vector3, dir: THREE.Vector3) => {
    if (!sceneRef.current) return;
    const laser = new THREE.Mesh(LASER_GEO, LASER_MAT.clone());
    
    laser.position.copy(pos);
    laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    
    sceneRef.current.add(laser);
    lasersRef.current.push({ mesh: laser, life: 1.0, dir: dir.clone() });
  };

  const handleShoot = () => {
    if (!modelRef.current || !innerModelRef.current || !sceneRef.current || health <= 0) return;
    
    const direction = new THREE.Vector3();
    modelRef.current.getWorldDirection(direction);
    direction.negate(); // El frente del auto es -Z local
    
    const position = new THREE.Vector3();
    modelRef.current.getWorldPosition(position);
    position.y += 0.05; // Ligeramente arriba del suelo
    position.add(direction.clone().multiplyScalar(0.15 * scale)); // Mover al frente del auto
    
    if (hasDoubleShot) {
      // Disparo doble en V
      const dir1 = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 12); // +15 grados
      const dir2 = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 12); // -15 grados
      
      createLaserVisual(position, dir1);
      createLaserVisual(position, dir2);
      
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('player-shoot', { 
          position: { x: position.x, y: position.y, z: position.z }, 
          direction: { x: dir1.x, y: dir1.y, z: dir1.z } 
        });
        socketRef.current.emit('player-shoot', { 
          position: { x: position.x, y: position.y, z: position.z }, 
          direction: { x: dir2.x, y: dir2.y, z: dir2.z } 
        });
        
        // Raycast para impactos
        const targets = Array.from(remotePlayersRef.current.values());
        
        const raycaster1 = new THREE.Raycaster(position, dir1, 0, 10);
        const intersects1 = raycaster1.intersectObjects(targets, true);
        if (intersects1.length > 0) {
          let hitId: string | null = null;
          for (const [id, playerGroup] of remotePlayersRef.current.entries()) {
            playerGroup.traverse((child) => {
              if (child === intersects1[0].object) hitId = id;
            });
          }
          if (hitId) socketRef.current.emit('player-hit', hitId);
        }
        
        const raycaster2 = new THREE.Raycaster(position, dir2, 0, 10);
        const intersects2 = raycaster2.intersectObjects(targets, true);
        if (intersects2.length > 0) {
          let hitId: string | null = null;
          for (const [id, playerGroup] of remotePlayersRef.current.entries()) {
            playerGroup.traverse((child) => {
              if (child === intersects2[0].object) hitId = id;
            });
          }
          if (hitId) socketRef.current.emit('player-hit', hitId);
        }
      }
    } else {
      // Disparo simple
      createLaserVisual(position, direction);
      
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('player-shoot', { 
          position: { x: position.x, y: position.y, z: position.z }, 
          direction: { x: direction.x, y: direction.y, z: direction.z } 
        });
        
        // Raycast for hits
        const raycaster = new THREE.Raycaster(position, direction, 0, 10);
        const targets = Array.from(remotePlayersRef.current.values());
        const intersects = raycaster.intersectObjects(targets, true);
        
        if (intersects.length > 0) {
          let hitId: string | null = null;
          for (const [id, playerGroup] of remotePlayersRef.current.entries()) {
            playerGroup.traverse((child) => {
              if (child === intersects[0].object) hitId = id;
            });
          }
          if (hitId) {
            socketRef.current.emit('player-hit', hitId);
          }
        }
      }
    }
  };

  // Fase 1: Conexión al servidor Multijugador
  useEffect(() => {
    if (carPlaced) {
      const timer = setTimeout(() => setShowGuide(false), 5000);
      return () => clearTimeout(timer);
    } else {
      setShowGuide(true);
    }
  }, [carPlaced]);

  useEffect(() => {
    // Si hay una URL en las variables de entorno, la usa (ej: servidor en Render). 
    // Si no, se conecta al servidor local (ej: en AI Studio).
    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Conectado al servidor multijugador. Mi ID:', socket.id);
      socket.emit('join-room', { roomId, playerName });
    });

    socket.on('player-joined', (data: { id: string, playerName: string }) => {
      playerNamesRef.current.set(data.id, data.playerName);
    });

    socket.on('player-moved', (data) => {
      const { id, position, rotation, scale: remoteScale, playerName: remotePlayerName, playerColor: remotePlayerColor } = data;
      if (!sceneRef.current || !modelTemplateRef.current) return;

      if (remotePlayerName) {
        playerNamesRef.current.set(id, remotePlayerName);
      }

      let remotePlayer = remotePlayersRef.current.get(id);

      if (!remotePlayer) {
        // Crear el auto del otro jugador clonando la plantilla
        remotePlayer = modelTemplateRef.current.clone();
        if (remotePlayerColor) applyCarColor(remotePlayer, remotePlayerColor);
        remotePlayer.visible = true; // Asegurarnos de que sea visible
        
        // Agregar nombre proporcional al tamaño del auto
        const nameSprite = createTextSprite(remotePlayerName || 'Piloto');
        // Escala fija para que el nombre sea legible y consistente
        nameSprite.scale.set(0.6, 0.2, 1);
        nameSprite.position.y = 0.4; // 40cm arriba del centro del auto
        nameSprite.renderOrder = 1000; // Asegurar que se renderice encima
        remotePlayer.add(nameSprite);
        
        sceneRef.current.add(remotePlayer);
        remotePlayersRef.current.set(id, remotePlayer);
        console.log('🚗 Nuevo jugador añadido a la escena:', id);
      }

      // Actualizar posición
      remotePlayer.position.set(position.x, position.y, position.z);
      // Actualizar rotación principal (dirección)
      remotePlayer.rotation.y = rotation.y;
      
      // Actualizar escala si el otro jugador la cambió
      if (remoteScale) {
        remotePlayer.scale.setScalar(remoteScale);
      }

      // Actualizar inclinación y salto (modelo interno)
      // El modelo interno es el primer hijo del wrapper
      const innerModel = remotePlayer.children[0];
      if (innerModel) {
        innerModel.rotation.x = rotation.x;
        innerModel.rotation.z = rotation.z;
      }
    });

    socket.on('player-disconnected', (id) => {
      console.log('❌ Jugador desconectado:', id);
      const remotePlayer = remotePlayersRef.current.get(id);
      if (remotePlayer && sceneRef.current) {
        sceneRef.current.remove(remotePlayer);
        remotePlayersRef.current.delete(id);
      }
    });

    socket.on('player-shoot', (data) => {
      const { position, direction } = data;
      const pos = new THREE.Vector3(position.x, position.y, position.z);
      const dir = new THREE.Vector3(direction.x, direction.y, direction.z);
      createLaserVisual(pos, dir);
    });

    socket.on('player-hit', ({ targetId, shooterId }) => {
      if (targetId === socket.id) {
        setHealth(h => {
          const newHealth = Math.max(0, h - 10);
          if (newHealth === 0 && h > 0) {
            setIsDead(true);
            const sName = shooterId === socket.id ? playerName : (playerNamesRef.current.get(shooterId) || 'Jugador');
            setKillerName(sName);
            socket.emit('player-eliminated', { targetId: socket.id, shooterId });
            if (modelRef.current) {
              // Turn car dark to indicate destruction
              modelRef.current.traverse((child: any) => {
                if (child.isMesh && child.material) {
                  child.material.color.setHex(0x222222);
                }
              });
            }
          }
          return newHealth;
        });
        if (navigator.vibrate) navigator.vibrate(200);
      }
    });

    socket.on('sync-items', (items) => {
      if (!sceneRef.current) return;
      
      // Clear existing items
      itemsRef.current.forEach(item => sceneRef.current?.remove(item.group));
      itemsRef.current.clear();
      
      items.forEach((item: any) => {
        const { group, sprite } = createIconItem(item.type === 'bomb' ? '💣' : '⚡');
        // Initial position, will be updated in the render loop relative to initialPlacementRef
        group.position.set(item.position.x, item.position.y, item.position.z);
        sceneRef.current?.add(group);
        itemsRef.current.set(item.id, { 
          group,
          sprite, 
          type: item.type, 
          seed: Math.random() * 100,
          serverX: item.position.x,
          serverZ: item.position.z
        });
      });
    });

    socket.on('item-spawned', (item: any) => {
      if (!sceneRef.current) return;
      const { group, sprite } = createIconItem(item.type === 'bomb' ? '💣' : '⚡');
      group.position.set(item.position.x, item.position.y, item.position.z);
      sceneRef.current.add(group);
      itemsRef.current.set(item.id, { 
        group,
        sprite, 
        type: item.type, 
        seed: Math.random() * 100,
        serverX: item.position.x,
        serverZ: item.position.z
      });
    });

    socket.on('item-expired', (itemId: string) => {
      const item = itemsRef.current.get(itemId);
      if (item && sceneRef.current) {
        sceneRef.current.remove(item.group);
        itemsRef.current.delete(itemId);
      }
    });

    socket.on('item-collected', ({ itemId, playerId, type }) => {
      const item = itemsRef.current.get(itemId);
      if (item && sceneRef.current) {
        sceneRef.current.remove(item.group);
        itemsRef.current.delete(itemId);
      }
      
      if (playerId === socket.id) {
        if (type === 'bomb') {
          setHealth(h => {
            const newHealth = Math.max(0, h - 20);
            if (newHealth === 0 && h > 0) {
              setIsDead(true);
              setKillerName(null);
              socket.emit('player-eliminated', { targetId: socket.id, shooterId: null });
              if (modelRef.current) {
                modelRef.current.traverse((child: any) => {
                  if (child.isMesh && child.material) {
                    child.material.color.setHex(0x222222);
                  }
                });
              }
            }
            return newHealth;
          });
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else if (type === 'doubleshot') {
          setHasDoubleShot(true);
          if (navigator.vibrate) navigator.vibrate(50);
        }
      }
    });

    socket.on('player-eliminated', ({ targetId, shooterId }) => {
      const targetName = targetId === socket.id ? playerName : (playerNamesRef.current.get(targetId) || 'Jugador');
      let sName = null;
      if (shooterId) {
        sName = shooterId === socket.id ? playerName : (playerNamesRef.current.get(shooterId) || 'Jugador');
      }
      setAnnouncement({ targetName, shooterName: sName });
      setTimeout(() => setAnnouncement(null), 5000);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const resetCar = () => {
    if (modelRef.current && initialPlacementRef.current) {
      modelRef.current.position.copy(initialPlacementRef.current.position);
      modelRef.current.quaternion.copy(initialPlacementRef.current.quaternion);
      modelRef.current.scale.setScalar(initialScale.current);
      setScale(1);
      isJumpingRef.current = false;
      jumpProgressRef.current = 0;
      // Reset inner model rotation as well
      if (innerModelRef.current) {
        innerModelRef.current.rotation.set(0, 0, 0);
        innerModelRef.current.position.y = innerModelRef.current.userData.baseY || 0;
        innerModelRef.current.userData.pitch = 0;
        innerModelRef.current.userData.roll = 0;
        innerModelRef.current.userData.bounce = 0;
        // Reset wheel steering
        frontWheelsRef.current.forEach(wheel => {
          const baseRot = initialWheelRotY.current.get(wheel) || 0;
          wheel.rotation.y = baseRot;
        });
      }
      joystickRef.current = { x: 0, y: 0 };
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    
    // ... existing scene setup ...
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    
    // Audio
    const listener = new THREE.AudioListener();
    camera.add(listener);
    const engineSound = new THREE.Audio(listener);
    const audioLoader = new THREE.AudioLoader();
    // Placeholder sound - user needs to replace this
    audioLoader.load('https://freesound.org/data/previews/235/235122_4464670-lq.mp3', (buffer) => {
      engineSound.setBuffer(buffer);
      engineSound.setLoop(true);
      engineSound.setVolume(0);
      engineSound.play();
    }, undefined, () => console.warn('Audio engineSound failed to load due to CORS.'));
    engineSoundRef.current = engineSound;
    
    const collisionSound = new THREE.Audio(listener);
    audioLoader.load('https://freesound.org/data/previews/369/369101_6843388-lq.mp3', (buffer) => {
      collisionSound.setBuffer(buffer);
      collisionSound.setVolume(0.5);
    }, undefined, () => console.warn('Audio collisionSound failed to load due to CORS.'));
    collisionSoundRef.current = collisionSound;
    
    const brakingSound = new THREE.Audio(listener);
    audioLoader.load('https://freesound.org/data/previews/171/171671_3230868-lq.mp3', (buffer) => {
      brakingSound.setBuffer(buffer);
      brakingSound.setVolume(0.5);
    }, undefined, () => console.warn('Audio brakingSound failed to load due to CORS.'));
    brakingSoundRef.current = brakingSound;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // Add HDR-like Environment for realistic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    scene.add(dirLight);

    // Reticle for placement
    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // AR Button
    const arButton = ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlayRef.current }
    });
    document.body.appendChild(arButton);

    // Controller for placement
    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', () => {
      if (reticle.visible && modelRef.current && !isPlacedRef.current) {
        modelRef.current.position.setFromMatrixPosition(reticle.matrix);
        modelRef.current.quaternion.setFromRotationMatrix(reticle.matrix);
        initialPlacementRef.current = {
          position: modelRef.current.position.clone(),
          quaternion: modelRef.current.quaternion.clone()
        };
        modelRef.current.visible = true;
        isPlacedRef.current = true;
        setCarPlaced(true);
        reticle.visible = false;
        
        // Agregar sprite de nombre propio
        const nameSprite = createTextSprite(playerName);
        // Escala fija para que el nombre sea legible y consistente
        nameSprite.scale.set(0.6, 0.2, 1);
        nameSprite.position.y = 0.4; // 40cm arriba del centro del auto
        nameSprite.renderOrder = 1000; // Asegurar que se renderice encima
        modelRef.current.add(nameSprite);

        // Emitir posición inicial al colocar el auto
        if (socketRef.current && socketRef.current.connected && innerModelRef.current) {
          socketRef.current.emit('player-moved', {
            position: {
              x: modelRef.current.position.x,
              y: modelRef.current.position.y,
              z: modelRef.current.position.z
            },
            rotation: {
              x: innerModelRef.current.rotation.x,
              y: modelRef.current.rotation.y,
              z: innerModelRef.current.rotation.z
            },
            scale: modelRef.current.scale.x,
            playerName,
            playerColor
          });
        }
      }
    });
    scene.add(controller);

    let hitTestSource: any = null;
    let hitTestSourceRequested = false;

    renderer.setAnimationLoop((timestamp, frame) => {
      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (!hitTestSourceRequested) {
          session.requestReferenceSpace('viewer').then((refSpace: any) => {
            session.requestHitTestSource({ space: refSpace }).then((source: any) => {
              hitTestSource = source;
            });
          });
          session.addEventListener('end', () => {
            hitTestSourceRequested = false;
            hitTestSource = null;
            isPlacedRef.current = false;
            setCarPlaced(false);
            if (modelRef.current) modelRef.current.visible = false;
          });
          hitTestSourceRequested = true;
        }

        if (hitTestSource && !isPlacedRef.current) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace);
            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        }

        // Joystick Movement Logic
        if (isPlacedRef.current && modelRef.current && innerModelRef.current && !isDead) {
          const { x, y } = joystickRef.current;
          
          const speed = 0.06 * speedMultiplierRef.current;
          const turnSpeed = 0.06 * speedMultiplierRef.current;
          const isMoving = Math.abs(x) > 0.01 || Math.abs(y) > 0.01;
          
          let targetTilt = 0;
          let targetPitch = 0;
          let steerAngle = 0;

          if (iocModeRef.current) {
            // --- IOC / HEADLESS MODE ---
            if (isMoving) {
              const camForward = new THREE.Vector3();
              camera.getWorldDirection(camForward);
              camForward.y = 0;
              if (camForward.lengthSq() > 0.001) camForward.normalize();
              else camForward.set(0, 0, -1);

              const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x);

              const moveDir = new THREE.Vector3()
                .addScaledVector(camForward, -y)
                .addScaledVector(camRight, x);

              if (moveDir.lengthSq() > 0.001) {
                moveDir.normalize();
                const moveAmount = Math.sqrt(x*x + y*y) * speed;

                const nextPos = modelRef.current.position.clone().add(moveDir.clone().multiplyScalar(moveAmount));
                let hasCollision = false;
                const collisionDistSq = Math.pow(0.25 * scale, 2);
                for (const remotePlayer of remotePlayersRef.current.values()) {
                  if (nextPos.distanceToSquared(remotePlayer.position) < collisionDistSq) {
                    hasCollision = true;
                    if (collisionSoundRef.current && !collisionSoundRef.current.isPlaying) collisionSoundRef.current.play();
                    break;
                  }
                }

                if (!hasCollision) {
                  modelRef.current.position.copy(nextPos);
                  distanceTraveledRef.current += moveAmount;
                }

                const targetYaw = Math.atan2(moveDir.x, moveDir.z);
                let currentYaw = modelRef.current.rotation.y;
                let diff = targetYaw - currentYaw;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                
                modelRef.current.rotation.y += diff * 0.15;
                
                steerAngle = diff * 0.5;
                targetTilt = diff * 0.3;
                targetPitch = -moveAmount * 1.5;
              }
            }
          } else {
            // --- STANDARD MODE ---
            const damping = 0.92;
            const acceleration = 0.003 * speedMultiplierRef.current;
            const turnAcceleration = 0.003 * speedMultiplierRef.current;

            velocityRef.current += (-y * acceleration);
            angularVelocityRef.current += (-x * turnAcceleration);

            velocityRef.current *= damping;
            angularVelocityRef.current *= damping;

            const moveZ = velocityRef.current;
            
            const forwardDir = new THREE.Vector3();
            modelRef.current.getWorldDirection(forwardDir);
            forwardDir.negate();
            
            const nextPos = modelRef.current.position.clone().add(forwardDir.clone().multiplyScalar(moveZ));
            let hasCollision = false;
            
            const collisionDistSq = Math.pow(0.25 * scale, 2);
            for (const remotePlayer of remotePlayersRef.current.values()) {
              if (nextPos.distanceToSquared(remotePlayer.position) < collisionDistSq) {
                hasCollision = true;
                if (collisionSoundRef.current && !collisionSoundRef.current.isPlaying) {
                  collisionSoundRef.current.play();
                }
                break;
              }
            }

            if (!hasCollision) {
              modelRef.current.translateZ(moveZ);
              distanceTraveledRef.current += Math.abs(moveZ);
            }
            
            modelRef.current.rotateY(angularVelocityRef.current);
            steerAngle = -angularVelocityRef.current * 10;
            targetTilt = (angularVelocityRef.current * 5);
            targetPitch = (velocityRef.current * 2);
          }

          // Check item collisions
          const itemDistSq = Math.pow(0.4 * scale, 2);
          for (const [itemId, item] of itemsRef.current.entries()) {
            const dx = modelRef.current.position.x - item.group.position.x;
            const dz = modelRef.current.position.z - item.group.position.z;
            const distSq2D = dx * dx + dz * dz;
            
            if (distSq2D < itemDistSq) {
              if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit('item-collected', itemId);
                scene.remove(item.group);
                itemsRef.current.delete(itemId);
              }
            }
          }

          // --- JUMP LOGIC ---
          let flipAngle = 0;
          let jumpY = 0;
          let normalizedJump = 0;
          if (isJumpingRef.current) {
            jumpProgressRef.current += 0.08;
            const progress = jumpProgressRef.current;
            if (progress >= 1) {
              isJumpingRef.current = false;
              jumpProgressRef.current = 0;
            } else {
              normalizedJump = Math.sin(progress * Math.PI);
              const worldJumpHeight = 0.5;
              const localJumpHeight = worldJumpHeight / initialScale.current;
              jumpY = normalizedJump * localJumpHeight;
              flipAngle = progress * Math.PI * 2;
            }
          }

          // --- REALISM EFFECTS (SUSPENSION) ---
          const noiseX = isMoving ? Math.sin(distanceTraveledRef.current * 40) * 0.015 : 0;
          const noiseZ = isMoving ? Math.cos(distanceTraveledRef.current * 45) * 0.015 : 0;
          const bounce = isMoving ? Math.abs(Math.sin(distanceTraveledRef.current * 50)) * 0.01 : 0;

          let currentRoll = innerModelRef.current.userData.roll || 0;
          currentRoll += ((targetTilt + noiseZ) - currentRoll) * 0.15;
          innerModelRef.current.userData.roll = currentRoll;
          innerModelRef.current.rotation.z = currentRoll;
          
          let currentPitch = innerModelRef.current.userData.pitch || 0;
          currentPitch += ((targetPitch + noiseX) - currentPitch) * 0.15;
          innerModelRef.current.userData.pitch = currentPitch;
          
          innerModelRef.current.rotation.x = currentPitch + flipAngle;

          const baseY = innerModelRef.current.userData.baseY || 0;
          let currentBounce = innerModelRef.current.userData.bounce || 0;
          currentBounce += (bounce - currentBounce) * 0.2;
          innerModelRef.current.userData.bounce = currentBounce;
          innerModelRef.current.position.y = baseY + currentBounce + jumpY;

          if (shadowMeshRef.current) {
            const shadowScale = Math.max(0.1, 1 - (normalizedJump * 0.8));
            shadowMeshRef.current.scale.set(shadowScale, shadowScale, shadowScale);
            // @ts-ignore
            shadowMeshRef.current.material.opacity = Math.max(0, 0.8 - (normalizedJump * 0.8));
          }

          frontWheelsRef.current.forEach(wheel => {
            const baseRot = initialWheelRotY.current.get(wheel) || 0;
            wheel.rotation.y = baseRot + Math.max(-0.5, Math.min(0.5, steerAngle));
          });

          // --- FASE 1: ENVIAR DATOS AL SERVIDOR ---
          if (isMoving || Math.abs(x) > 0.01 || isJumpingRef.current) {
            const now = performance.now();
            if (now - lastEmitTimeRef.current > 50) { // Throttle to 20Hz
              lastEmitTimeRef.current = now;
              if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit('player-moved', {
                  position: {
                    x: modelRef.current.position.x,
                    y: modelRef.current.position.y,
                    z: modelRef.current.position.z
                  },
                  rotation: {
                    x: innerModelRef.current.rotation.x,
                    y: modelRef.current.rotation.y,
                    z: innerModelRef.current.rotation.z
                  },
                  scale: modelRef.current.scale.x,
                  playerName,
                  playerColor
                });
              }
            }
          }

          // 5. Update Engine Sound
          if (engineSoundRef.current) {
            const speed = Math.abs(y);
            engineSoundRef.current.setPlaybackRate(0.5 + speed * 1.5);
            engineSoundRef.current.setVolume(0.2 + speed * 0.8);
          }

          // 6. Braking Sound
          if (Math.abs(prevYRef.current) > 0.1 && Math.abs(y) < 0.05) {
            if (brakingSoundRef.current && !brakingSoundRef.current.isPlaying) {
              brakingSoundRef.current.play();
            }
          }
          prevYRef.current = y;

          // 7. Collision Sound (Boundary Check)
          const pos = modelRef.current.position;
          if (Math.abs(pos.x) > 5 || Math.abs(pos.z) > 5) {
            if (collisionSoundRef.current && !collisionSoundRef.current.isPlaying) {
              collisionSoundRef.current.play();
            }
          }
        }
        
        // Update Lasers
        const delta = 0.016; // Approx 60fps delta
        for (let i = lasersRef.current.length - 1; i >= 0; i--) {
          const laser = lasersRef.current[i];
          laser.life -= delta * 1.5; // Slower fade (dura ~0.66 segundos)
          if (laser.life <= 0) {
            scene.remove(laser.mesh);
            lasersRef.current.splice(i, 1);
          } else {
            (laser.mesh.material as THREE.MeshBasicMaterial).opacity = laser.life;
            laser.mesh.position.add(laser.dir.clone().multiplyScalar(delta * 2.5)); // Slower speed (2.5 m/s)
          }
        }
        
        // Animate Items
        const time = Date.now() * 0.005;
        const floorY = initialPlacementRef.current?.position.y || 0;
        
        for (const item of itemsRef.current.values()) {
          // Animación de pulso (escala)
          const baseScale = 0.35; // Más grande
          const pulse = baseScale + Math.sin(time * 1.5 + item.seed) * 0.02;
          item.sprite.scale.set(pulse, pulse, pulse);
          
          // Posición absoluta enviada por el servidor
          item.group.position.x = item.serverX;
          item.group.position.z = item.serverZ;
          // El grupo va en el piso
          item.group.position.y = floorY;
          // El sprite se eleva un poco para no atravesar el piso
          item.sprite.position.y = pulse / 2;
        }
        
      }
      renderer.render(scene, camera);
    });

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    
    // Cerrar menú al hacer clic en el aire
    const handleCanvasClick = (event: MouseEvent) => {
      if (showMenu && !(event.target as HTMLElement).closest('.menu-container')) {
        setShowMenu(false);
      }
    };
    renderer.domElement.addEventListener('click', handleCanvasClick);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (arButton.parentNode) {
        arButton.parentNode.removeChild(arButton);
      }
      renderer.dispose();
    };
  }, []);

  // Load Model Effect
  useEffect(() => {
    if (!modelSource || !sceneRef.current) return;

    setLoading(true);
    setError(null);

    // Remove previous model if exists
    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      modelRef.current = null;
      isPlacedRef.current = false;
      setCarPlaced(false);
    }

    const loader = new GLTFLoader();
    const url = typeof modelSource === 'string' ? modelSource : URL.createObjectURL(modelSource);

    loader.load(url, (gltf: any) => {
      const model = gltf.scene;
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.material.envMapIntensity = 1.5;
          child.material.metalness = 0.8;
          child.material.roughness = 0.2;
        }
      });
      innerModelRef.current = model;
      
      // Find wheels by name (if they are separated in Blender)
      const frontWheels: THREE.Object3D[] = [];
      const rearWheels: THREE.Object3D[] = [];
      model.traverse((child: any) => {
        const name = child.name.toLowerCase();
        if (name.includes('wheel') || name.includes('rueda') || name.includes('tire') || name.includes('llanta')) {
          initialWheelRotY.current.set(child, child.rotation.y);
          if (name.includes('trasera') || name.includes('back') || name.includes('rear')) {
            rearWheels.push(child);
          } else {
            frontWheels.push(child);
          }
        }
      });
      frontWheelsRef.current = frontWheels;
      rearWheelsRef.current = rearWheels;
      
      // Create a wrapper group to center the model's pivot
      const wrapper = new THREE.Group();
      
      // Calculate bounding box to find center and bottom
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      // Center the model inside the wrapper, aligning bottom to Y=0
      model.position.x = -center.x;
      model.position.y = -box.min.y;
      model.position.z = -center.z;
      model.userData.baseY = -box.min.y;
      
      wrapper.add(model);
      innerModelRef.current = model;

      // Create Fake Shadow (Zero performance cost)
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(0,0,0, 0.8)');
        gradient.addColorStop(0.4, 'rgba(0,0,0, 0.5)');
        gradient.addColorStop(1, 'rgba(0,0,0, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }
      const shadowTexture = new THREE.CanvasTexture(canvas);
      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      });
      const shadowGeometry = new THREE.PlaneGeometry(size.x * 1.5, size.z * 1.5);
      const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.01; // Slightly above ground to avoid z-fighting
      
      wrapper.add(shadowMesh);
      shadowMeshRef.current = shadowMesh;
      
      // Scale wrapper to a reasonable size (e.g., 30cm)
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 0.3 / maxDim;
      wrapper.scale.setScalar(scale);
      initialScale.current = scale;
      
      // Guardar una copia limpia como plantilla para los otros jugadores
      modelTemplateRef.current = wrapper.clone();
      
      // Aplicar el color elegido al auto local
      applyCarColor(wrapper, playerColor);
      
      wrapper.visible = false;
      sceneRef.current!.add(wrapper);
      modelRef.current = wrapper;
      setLoading(false);

      if (typeof modelSource !== 'string') {
        URL.revokeObjectURL(url);
      }
    }, undefined, (err: any) => {
      console.error(err);
      setError('Error 404: El repositorio de GitHub es privado o el archivo no existe.');
      setLoading(false);
      setModelSource(null); // Clear source to show fallback UI
      
      if (typeof modelSource !== 'string') {
        URL.revokeObjectURL(url);
      }
    });
  }, [modelSource]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setModelSource(e.target.files[0]);
    }
  };

  return (
    <div ref={overlayRef} className="relative w-full h-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />
      
      {(!carPlaced || showGuide) && (
        <div className="absolute top-6 left-6 right-6 flex justify-between items-start pointer-events-none z-40">
          <div className="pointer-events-auto bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-2xl transition-opacity duration-500">
            <h2 className="text-white font-bold text-lg tracking-wide">
              LOLA CONTROL REMOTO
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {loading ? 'Cargando modelo...' : 
               !modelSource ? 'Sube tu archivo GLB manualmente' :
               carPlaced ? '¡Usa el joystick para conducir!' : 
               'Apunta al suelo hasta que aparezca un circulo verde y toca para colocar a LOLA'}
            </p>
          </div>
        </div>
      )}

      {!modelSource && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-50 p-8 text-center">
          <div className="bg-emerald-500/20 p-4 rounded-full mb-4">
            <AlertCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-white font-bold text-xl mb-2">Repositorio Privado o No Encontrado</h3>
          <p className="text-white/70 max-w-md mb-6">
            No se pudo descargar el archivo desde GitHub. Si acabas de hacerlo público, intenta conectar de nuevo.
            <br/><br/>
            Opcionalmente, puedes subir el archivo <strong>LOLA-GLB.glb</strong> manualmente.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button 
              onClick={() => setModelSource(MODEL_URL)}
              className="px-6 py-3 bg-white/10 text-white border border-white/20 rounded-full font-bold hover:bg-white/20 transition-colors"
            >
              Reintentar conexión
            </button>
            <label className="cursor-pointer px-6 py-3 bg-emerald-500 text-black rounded-full font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Subir archivo GLB
              <input 
                type="file" 
                accept=".glb,.gltf" 
                className="hidden" 
                onChange={handleFileUpload} 
              />
            </label>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-50">
          <Loader2 className="w-12 h-12 text-emerald-400 animate-spin mb-4" />
          <p className="text-white font-medium text-lg">Cargando LOLA-GLB...</p>
        </div>
      )}

      {error && modelSource && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-50 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-white font-bold text-xl mb-2">Error</h3>
          <p className="text-white/70 max-w-md">{error}</p>
        </div>
      )}

      {carPlaced && (
        <>
          {/* Health Bar */}
          <div className="absolute left-4 right-4 bg-zinc-900/80 p-2 rounded-full border border-white/10 backdrop-blur-md z-50 flex items-center gap-3" style={{ top: 'max(0.5rem, env(safe-area-inset-top))' }}>
            <div className="text-white font-bold text-sm ml-2 w-12">{health}%</div>
            <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${health > 50 ? 'bg-emerald-500' : health > 20 ? 'bg-yellow-500' : 'bg-red-500'}`} 
                style={{ width: `${health}%` }} 
              />
            </div>
          </div>

          {isDead && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80 backdrop-blur-md z-[60] p-8 text-center animate-in fade-in">
              {killerName ? (
                <>
                  <h1 className="text-4xl font-black text-red-500 mb-4 tracking-tighter uppercase">ELIMINADO: {playerName}</h1>
                  <h2 className="text-2xl font-bold text-white mb-8 uppercase">POR: {killerName}</h2>
                </>
              ) : (
                <>
                  <h1 className="text-4xl font-black text-red-500 mb-4 tracking-tighter uppercase">{playerName}</h1>
                  <h2 className="text-2xl font-bold text-white mb-8 uppercase">FUERA DE JUEGO</h2>
                </>
              )}
              <button 
                onClick={() => window.location.reload()}
                className="bg-white text-red-950 font-bold py-4 px-8 rounded-full text-xl hover:bg-zinc-200 transition-colors"
              >
                Volver a Jugar
              </button>
            </div>
          )}

          {announcement && !isDead && (
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md z-[55] p-6 rounded-2xl text-center animate-in fade-in zoom-in duration-300 pointer-events-none">
              {announcement.shooterName ? (
                <>
                  <h1 className="text-2xl font-black text-red-500 mb-2 tracking-tighter uppercase">ELIMINADO: {announcement.targetName}</h1>
                  <h2 className="text-xl font-bold text-white uppercase">POR: {announcement.shooterName}</h2>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-black text-red-500 mb-2 tracking-tighter uppercase">{announcement.targetName}</h1>
                  <h2 className="text-xl font-bold text-white uppercase">FUERA DE JUEGO</h2>
                </>
              )}
            </div>
          )}

          {/* Top/Center controls (Reset & Scale & Speed) */}
          <div className="absolute z-50 pointer-events-auto flex flex-col items-center gap-2" style={{ top: 'calc(max(0.5rem, env(safe-area-inset-top)) + 3.5rem)', left: '50%', transform: 'translateX(-50%)' }}>
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="bg-black/60 backdrop-blur-md border border-white/20 text-white p-2 rounded-full hover:bg-black/80 transition-colors shadow-lg"
            >
              <Settings size={24} />
            </button>
            
            {showMenu && (
              <div className="flex flex-col gap-3 bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-lg animate-in fade-in slide-in-from-top-2">
                <button 
                  onClick={resetCar}
                  className="bg-white/10 border border-white/20 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-white/20 transition-colors w-full"
                >
                  RESET
                </button>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-white text-xs font-bold w-16">Control IOC:</span>
                  <button 
                    onClick={() => {
                      setIocMode(!iocMode);
                      iocModeRef.current = !iocMode;
                    }}
                    className={`w-12 h-6 rounded-full transition-colors relative ${iocMode ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${iocMode ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-white text-xs font-bold w-16">Escala:</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const newScale = Math.max(0.1, Math.min(2.0, scale - 0.1));
                        setScale(newScale);
                        if (modelRef.current) modelRef.current.scale.setScalar(initialScale.current * newScale);
                      }} 
                      className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-white font-bold hover:bg-white/20 active:scale-95"
                    >
                      -
                    </button>
                    <span className="text-white text-xs w-8 text-center">{scale.toFixed(1)}x</span>
                    <button 
                      onClick={() => {
                        const newScale = Math.max(0.1, Math.min(2.0, scale + 0.1));
                        setScale(newScale);
                        if (modelRef.current) modelRef.current.scale.setScalar(initialScale.current * newScale);
                      }} 
                      className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-white font-bold hover:bg-white/20 active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-white text-xs font-bold w-16">Velocidad:</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const newSpeed = Math.max(0.2, Math.min(3.0, speedMultiplier - 0.2));
                        setSpeedMultiplier(newSpeed);
                        speedMultiplierRef.current = newSpeed;
                      }} 
                      className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-white font-bold hover:bg-white/20 active:scale-95"
                    >
                      -
                    </button>
                    <span className="text-white text-xs w-8 text-center">{speedMultiplier.toFixed(1)}x</span>
                    <button 
                      onClick={() => {
                        const newSpeed = Math.max(0.2, Math.min(3.0, speedMultiplier + 0.2));
                        setSpeedMultiplier(newSpeed);
                        speedMultiplierRef.current = newSpeed;
                      }} 
                      className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-white font-bold hover:bg-white/20 active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Left: SALTO y FUEGO */}
          <div className="absolute z-50 pointer-events-auto flex flex-col sm:flex-row gap-4" style={{ bottom: 'max(3rem, env(safe-area-inset-bottom))', left: 'max(2rem, env(safe-area-inset-left))' }}>
            <button 
              onPointerDown={(e) => { 
                e.preventDefault(); 
                if (!isJumpingRef.current && !isDead) isJumpingRef.current = true; 
              }}
              disabled={isDead}
              className="bg-emerald-500/80 backdrop-blur-md border border-emerald-400 text-white w-20 h-20 rounded-full text-sm font-bold hover:bg-emerald-400 transition-colors shadow-xl active:scale-95 touch-none select-none flex items-center justify-center disabled:opacity-50"
            >
              SALTO
            </button>
            <button 
              onPointerDown={(e) => { 
                e.preventDefault(); 
                handleShoot();
              }}
              disabled={isDead}
              className="bg-red-500/80 backdrop-blur-md border border-red-400 text-white w-20 h-20 rounded-full text-sm font-bold hover:bg-red-400 transition-colors shadow-xl active:scale-95 touch-none select-none flex flex-col items-center justify-center disabled:opacity-50"
            >
              <Crosshair size={24} className="mb-1" />
              FUEGO
            </button>
          </div>

          {/* Bottom Right: Joystick */}
          <div className="absolute z-50 pointer-events-auto" style={{ bottom: 'max(3rem, env(safe-area-inset-bottom))', right: 'max(2rem, env(safe-area-inset-right))' }}>
            <Joystick onChange={(data) => { if (!isDead) joystickRef.current = data; }} />
          </div>
        </>
      )}
    </div>
  );
}
