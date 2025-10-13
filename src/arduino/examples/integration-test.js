/**
 * Script de prueba de integración
 * Verifica que todos los componentes funcionen correctamente
 */

const { getInstance, ArduinoController } = require('../ArduinoController');
const { ARDUINO_COMMANDS } = require('../commands');
const ResponseParser = require('../parser');

class IntegrationTest {
    constructor() {
        this.arduino = getInstance();
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    async runAllTests() {
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║  Test de Integración - Arduino System     ║');
        console.log('╚════════════════════════════════════════════╝\n');

        // Tests de conexión
        await this.testListPorts();
        await this.testConnection();
        
        // Tests de comandos
        await this.testModeCommands();
        await this.testMovementCommands();
        
        // Tests de parser
        await this.testParser();
        
        // Tests de estado
        await this.testStateManagement();
        
        // Desconectar
        await this.testDisconnection();

        this.printResults();
    }

    async testListPorts() {
        try {
            console.log('🧪 Test: Listar puertos disponibles');
            const ports = await ArduinoController.listAvailablePorts();
            
            if (Array.isArray(ports)) {
                console.log(`   ✓ Se encontraron ${ports.length} puertos`);
                ports.forEach(port => {
                    console.log(`     - ${port.path} (${port.manufacturer})`);
                });
                this.passed++;
            } else {
                throw new Error('La respuesta no es un array');
            }
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    async testConnection() {
        try {
            console.log('🧪 Test: Conectar con Arduino');
            await this.arduino.connect();
            
            if (this.arduino.isConnected) {
                console.log('   ✓ Conexión establecida');
                console.log(`   ✓ Puerto: ${this.arduino.portPath}`);
                this.passed++;
            } else {
                throw new Error('No se pudo establecer conexión');
            }
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            console.log('   ℹ Continuando tests sin Arduino físico...');
            this.failed++;
        }
        console.log('');
    }

    async testModeCommands() {
        if (!this.arduino.isConnected) {
            console.log('🧪 Test: Comandos de modo (SALTADO - Sin conexión)\n');
            return;
        }

        try {
            console.log('🧪 Test: Comandos de modo');
            
            // Modo Manual
            await this.arduino.setModeManual();
            await this.delay(500);
            console.log('   ✓ Comando MODE_MANUAL enviado');
            
            // Modo Automático
            await this.arduino.setModeAutomatic();
            await this.delay(500);
            console.log('   ✓ Comando MODE_AUTOMATIC enviado');
            
            this.passed++;
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    async testMovementCommands() {
        if (!this.arduino.isConnected) {
            console.log('🧪 Test: Comandos de movimiento (SALTADO - Sin conexión)\n');
            return;
        }

        try {
            console.log('🧪 Test: Comandos de movimiento');
            
            // Movimiento Y (pequeño para no dañar el equipo)
            await this.arduino.moveAxisY(100);
            await this.delay(500);
            console.log('   ✓ Comando MOVE_Y enviado');
            
            // Movimiento Z (pequeño para no dañar el equipo)
            await this.arduino.moveAxisZ(50);
            await this.delay(500);
            console.log('   ✓ Comando MOVE_Z enviado');
            
            this.passed++;
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    async testParser() {
        console.log('🧪 Test: Parser de respuestas');
        
        try {
            // Test parseo de modo
            const modeResult = ResponseParser.parse('Modo Manual');
            if (modeResult && modeResult.type === 'mode' && modeResult.mode === 'MANUAL') {
                console.log('   ✓ Parser de modo funcionando');
            } else {
                throw new Error('Parser de modo falló');
            }

            // Test parseo de HOME
            const homeResult = ResponseParser.parse('Home Y encontrado');
            if (homeResult && homeResult.type === 'home' && homeResult.axis === 'Y') {
                console.log('   ✓ Parser de HOME funcionando');
            } else {
                throw new Error('Parser de HOME falló');
            }

            // Test parseo de posición
            const posResult = ResponseParser.parse('Y: 1500');
            if (posResult && posResult.type === 'position' && posResult.position === 1500) {
                console.log('   ✓ Parser de posición funcionando');
            } else {
                throw new Error('Parser de posición falló');
            }

            // Test parseo de límite
            const limitResult = ResponseParser.parse('Limite Y Min alcanzado');
            if (limitResult && limitResult.type === 'limit' && limitResult.axis === 'Y') {
                console.log('   ✓ Parser de límites funcionando');
            } else {
                throw new Error('Parser de límites falló');
            }

            // Test parseo de emergencia
            const emergencyResult = ResponseParser.parse('PARO DE EMERGENCIA ACTIVADO');
            if (emergencyResult && emergencyResult.type === 'emergency' && emergencyResult.active) {
                console.log('   ✓ Parser de emergencia funcionando');
            } else {
                throw new Error('Parser de emergencia falló');
            }

            this.passed++;
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    async testStateManagement() {
        console.log('🧪 Test: Gestión de estado');
        
        try {
            const state = this.arduino.getState();
            
            if (typeof state === 'object') {
                console.log('   ✓ Estado es un objeto válido');
            }
            
            if (state.hasOwnProperty('isConnected')) {
                console.log('   ✓ Estado contiene isConnected');
            }
            
            if (state.hasOwnProperty('mode')) {
                console.log('   ✓ Estado contiene mode');
            }
            
            if (state.axisY && state.axisZ) {
                console.log('   ✓ Estado contiene información de ejes');
            }
            
            this.passed++;
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    async testDisconnection() {
        if (!this.arduino.isConnected) {
            console.log('🧪 Test: Desconexión (SALTADO - No estaba conectado)\n');
            return;
        }

        try {
            console.log('🧪 Test: Desconexión');
            await this.arduino.disconnect();
            
            if (!this.arduino.isConnected) {
                console.log('   ✓ Desconexión exitosa');
                this.passed++;
            } else {
                throw new Error('No se pudo desconectar');
            }
        } catch (error) {
            console.log(`   ✗ Falló: ${error.message}`);
            this.failed++;
        }
        console.log('');
    }

    printResults() {
        const total = this.passed + this.failed;
        const percentage = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0;
        
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║           Resultados de Tests              ║');
        console.log('╚════════════════════════════════════════════╝');
        console.log(`\nTotal: ${total}`);
        console.log(`✓ Pasados: ${this.passed}`);
        console.log(`✗ Fallados: ${this.failed}`);
        console.log(`Porcentaje: ${percentage}%`);
        
        if (this.failed === 0) {
            console.log('\n🎉 ¡Todos los tests pasaron exitosamente!\n');
        } else {
            console.log('\n⚠️  Algunos tests fallaron. Revisar la salida anterior.\n');
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Ejecutar tests si se llama directamente
if (require.main === module) {
    const test = new IntegrationTest();
    test.runAllTests()
        .then(() => process.exit(test.failed > 0 ? 1 : 0))
        .catch(error => {
            console.error('Error fatal:', error);
            process.exit(1);
        });
}

module.exports = IntegrationTest;


