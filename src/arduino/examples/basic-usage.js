/**
 * Ejemplo básico de uso del controlador de Arduino
 * Este archivo muestra cómo usar el controlador en diferentes escenarios
 */

const { getInstance, ArduinoController } = require('../ArduinoController');

// =============================================================================
// Ejemplo 1: Conexión básica
// =============================================================================
async function example1_BasicConnection() {
    console.log('\n=== Ejemplo 1: Conexión Básica ===\n');
    
    const arduino = getInstance();
    
    try {
        // Conectar automáticamente (detecta el puerto)
        await arduino.connect();
        console.log('✓ Arduino conectado');
        
        // Obtener estado
        const state = arduino.getState();
        console.log('Estado actual:', state);
        
        // Desconectar
        await arduino.disconnect();
        console.log('✓ Arduino desconectado');
        
    } catch (error) {
        console.error('✗ Error:', error.message);
    }
}

// =============================================================================
// Ejemplo 2: Listar puertos disponibles y conectar a uno específico
// =============================================================================
async function example2_ListAndConnect() {
    console.log('\n=== Ejemplo 2: Listar Puertos y Conectar ===\n');
    
    try {
        // Listar puertos disponibles
        const ports = await ArduinoController.listAvailablePorts();
        console.log('Puertos disponibles:');
        ports.forEach((port, index) => {
            console.log(`  ${index + 1}. ${port.path} - ${port.manufacturer}`);
        });
        
        if (ports.length > 0) {
            // Conectar al primer puerto
            const arduino = getInstance();
            await arduino.connect(ports[0].path);
            console.log(`✓ Conectado a ${ports[0].path}`);
            
            await arduino.disconnect();
        }
        
    } catch (error) {
        console.error('✗ Error:', error.message);
    }
}

// =============================================================================
// Ejemplo 3: Escuchar eventos del Arduino
// =============================================================================
async function example3_ListenEvents() {
    console.log('\n=== Ejemplo 3: Escuchar Eventos ===\n');
    
    const arduino = getInstance();
    
    // Configurar listeners antes de conectar
    arduino.on('connected', (data) => {
        console.log('✓ Evento: Conectado', data);
    });
    
    arduino.on('data', (parsed) => {
        console.log('📥 Evento: Datos recibidos', parsed);
    });
    
    arduino.on('state-changed', (state) => {
        console.log('🔄 Evento: Estado cambiado', {
            mode: state.mode,
            axisY: state.axisY.position,
            axisZ: state.axisZ.position
        });
    });
    
    arduino.on('error', (error) => {
        console.error('✗ Evento: Error', error);
    });
    
    arduino.on('disconnected', () => {
        console.log('✗ Evento: Desconectado');
    });
    
    try {
        await arduino.connect();
        
        // Esperar un poco para ver eventos
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await arduino.disconnect();
        
    } catch (error) {
        console.error('✗ Error:', error.message);
    }
}

// =============================================================================
// Ejemplo 4: Comandos básicos de movimiento
// =============================================================================
async function example4_BasicCommands() {
    console.log('\n=== Ejemplo 4: Comandos Básicos ===\n');
    
    const arduino = getInstance();
    
    try {
        await arduino.connect();
        console.log('✓ Conectado');
        
        // Cambiar a modo manual
        console.log('\n1. Cambiando a modo MANUAL...');
        await arduino.setModeManual();
        await delay(1000);
        
        // Mover eje Y
        console.log('\n2. Moviendo eje Y (1000 pasos)...');
        await arduino.moveAxisY(1000);
        await delay(2000);
        
        // Mover eje Z
        console.log('\n3. Moviendo eje Z (500 pasos)...');
        await arduino.moveAxisZ(500);
        await delay(2000);
        
        // Cambiar a modo automático
        console.log('\n4. Cambiando a modo AUTOMÁTICO...');
        await arduino.setModeAutomatic();
        await delay(1000);
        
        console.log('\n✓ Comandos ejecutados exitosamente');
        
        await arduino.disconnect();
        
    } catch (error) {
        console.error('✗ Error:', error.message);
    }
}

// =============================================================================
// Ejemplo 5: Secuencia HOME
// =============================================================================
async function example5_HomeSequence() {
    console.log('\n=== Ejemplo 5: Secuencia HOME ===\n');
    
    const arduino = getInstance();
    
    // Escuchar eventos HOME específicos
    arduino.on('data', (parsed) => {
        if (parsed.type === 'home') {
            if (parsed.status === 'searching') {
                console.log(`🔍 Buscando HOME en eje ${parsed.axis}...`);
            } else if (parsed.complete) {
                console.log(`✓ HOME encontrado en eje ${parsed.axis}`);
            }
        }
    });
    
    try {
        await arduino.connect();
        console.log('✓ Conectado\n');
        
        console.log('Ejecutando secuencia HOME...');
        await arduino.executeHome();
        
        // Esperar a que complete (el HOME puede tomar varios segundos)
        await delay(10000);
        
        console.log('\n✓ Secuencia HOME completada');
        
        await arduino.disconnect();
        
    } catch (error) {
        console.error('✗ Error:', error.message);
    }
}

// =============================================================================
// Ejemplo 6: Monitoreo continuo del estado
// =============================================================================
async function example6_ContinuousMonitoring() {
    console.log('\n=== Ejemplo 6: Monitoreo Continuo ===\n');
    
    const arduino = getInstance();
    
    // Monitorear estado cada 2 segundos
    let monitorInterval;
    
    arduino.on('connected', () => {
        console.log('✓ Iniciando monitoreo...\n');
        
        monitorInterval = setInterval(() => {
            const state = arduino.getState();
            
            console.clear();
            console.log('=== Estado del Arduino ===');
            console.log(`Conectado: ${state.isConnected ? '✓' : '✗'}`);
            console.log(`Puerto: ${state.port || 'N/A'}`);
            console.log(`Modo: ${state.mode}`);
            console.log(`\nEje Y:`);
            console.log(`  Posición: ${state.axisY.position}`);
            console.log(`  En Home: ${state.axisY.atHome ? 'Sí' : 'No'}`);
            console.log(`  En Límite: ${state.axisY.atLimit ? 'Sí' : 'No'}`);
            console.log(`\nEje Z:`);
            console.log(`  Posición: ${state.axisZ.position}`);
            console.log(`  En Home: ${state.axisZ.atHome ? 'Sí' : 'No'}`);
            console.log(`  En Límite: ${state.axisZ.atLimit ? 'Sí' : 'No'}`);
            console.log(`\nEmergencia: ${state.emergencyStop ? '⚠️ ACTIVADA' : 'Normal'}`);
            console.log(`Última actualización: ${state.lastUpdate || 'Nunca'}`);
        }, 2000);
    });
    
    try {
        await arduino.connect();
        
        // Monitorear por 30 segundos
        await delay(30000);
        
        clearInterval(monitorInterval);
        await arduino.disconnect();
        
    } catch (error) {
        console.error('✗ Error:', error.message);
        if (monitorInterval) clearInterval(monitorInterval);
    }
}

// =============================================================================
// Utilidades
// =============================================================================
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Ejecutar ejemplos
// =============================================================================
async function runExamples() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║  Ejemplos de Uso - Arduino Controller     ║');
    console.log('╚════════════════════════════════════════════╝');
    
    // Descomenta el ejemplo que quieras ejecutar
    
    // await example1_BasicConnection();
    // await example2_ListAndConnect();
    // await example3_ListenEvents();
    // await example4_BasicCommands();
    // await example5_HomeSequence();
    // await example6_ContinuousMonitoring();
    
    console.log('\n✓ Ejemplos completados\n');
}

// Ejecutar si se llama directamente
if (require.main === module) {
    runExamples().catch(console.error);
}

module.exports = {
    example1_BasicConnection,
    example2_ListAndConnect,
    example3_ListenEvents,
    example4_BasicCommands,
    example5_HomeSequence,
    example6_ContinuousMonitoring
};


