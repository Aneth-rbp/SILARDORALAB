# 📚 Documentación del Sistema SILAR

Bienvenido a la documentación completa del Sistema SILAR - Control de Laboratorio con integración Arduino.

## 📖 Índice General

### 🚀 Inicio Rápido
- **[Guía de Inicio Rápido](../README.md)** - Instalación y configuración inicial
- **[Próximos Pasos](./guides/next-steps.md)** - Qué hacer después de la instalación

### 🤖 Integración Arduino
- **[Resumen Ejecutivo](./arduino/integration-summary.md)** - Visión general de la integración
- **[Guía Rápida Arduino](./arduino/quick-start.md)** - Flashear y conectar en 5 minutos
- **[Documentación Completa Arduino](./arduino/README.md)** - Todo sobre el controlador Arduino
- **[Arquitectura del Sistema](./arduino/architecture.md)** - Diagramas y flujos de datos
- **[Sistema de Flash](./arduino/flasher.md)** - Flash automático del firmware

### 🧪 Recetas
- **[Recetas por etapas](./recetas-por-etapas.md)** - Encadenar varios juegos de parámetros en una sola corrida

### 🔄 Despliegue
- **[Actualizaciones remotas (OTA)](./actualizaciones.md)** - Publicar versiones y actualizar el equipo del laboratorio sin ir en persona

### 🌐 API Reference
- **[API Arduino REST](./api/arduino-api.md)** - Endpoints y ejemplos de uso

### 📋 Guías de Desarrollo
- **[Próximos Pasos](./guides/next-steps.md)** - Roadmap y tareas sugeridas
- **[Mejores Prácticas](./guides/best-practices.md)** - Convenciones y estándares

## 🎯 Documentos por Rol

### Para Usuarios Finales
1. [README Principal](../README.md) - Cómo usar la aplicación
2. [Guía Rápida Arduino](./arduino/quick-start.md) - Conectar el hardware

### Para Desarrolladores
1. [Arquitectura](./arduino/architecture.md) - Entender el sistema
2. [API Reference](./api/arduino-api.md) - Integrar con el código
3. [Próximos Pasos](./guides/next-steps.md) - Qué desarrollar

### Para Administradores de Sistema
1. [Sistema de Flash](./arduino/flasher.md) - Instalar firmware
2. [Documentación Completa](./arduino/README.md) - Configuración avanzada

## 📁 Estructura de Documentación

```
docs/
├── README.md (este archivo)        # Índice principal
│
├── arduino/                        # Documentación Arduino
│   ├── README.md                   # Documentación técnica completa
│   ├── quick-start.md              # Guía rápida 5 minutos
│   ├── architecture.md             # Diagramas y arquitectura
│   ├── integration-summary.md      # Resumen ejecutivo
│   └── flasher.md                  # Sistema de flash automático
│
├── api/                            # Referencias API
│   └── arduino-api.md              # API REST Arduino
│
└── guides/                         # Guías y tutoriales
    ├── next-steps.md               # Roadmap y tareas
    └── best-practices.md           # Mejores prácticas
```

## 🔍 Búsqueda Rápida

### ¿Cómo...?

- **¿Cómo flashear el Arduino?** → [Quick Start Arduino](./arduino/quick-start.md#flashear-el-arduino)
- **¿Cómo conectar desde código?** → [API Arduino](./api/arduino-api.md#conexión)
- **¿Cómo enviar comandos?** → [API Arduino](./api/arduino-api.md#comandos)
- **¿Cómo funciona el sistema?** → [Arquitectura](./arduino/architecture.md)
- **¿Qué hago después?** → [Próximos Pasos](./guides/next-steps.md)

### ¿Dónde está...?

- **Código del Arduino** → `src/arduino/arduino-sketch/SILAR_Control.ino`
- **Controlador principal** → `src/arduino/ArduinoController.js`
- **Sistema de flash** → `src/arduino/flasher/ArduinoFlasher.js`
- **Interfaz web** → `src/public/js/screens/manual.js`
- **API REST** → `server.js` (rutas `/api/arduino/*`)

## 🎓 Tutoriales por Nivel

### Nivel Básico
1. [Guía Rápida](./arduino/quick-start.md) - Conectar y usar
2. [Resumen de Integración](./arduino/integration-summary.md) - Qué puedes hacer

### Nivel Intermedio
3. [API Reference](./api/arduino-api.md) - Programar con el sistema
4. [Próximos Pasos](./guides/next-steps.md) - Extender funcionalidad

### Nivel Avanzado
5. [Arquitectura](./arduino/architecture.md) - Entender el diseño
6. [Documentación Completa](./arduino/README.md) - Detalles técnicos
7. [Sistema de Flash](./arduino/flasher.md) - Automatización avanzada

## 🆘 Solución de Problemas

- **Arduino no conecta** → [Quick Start](./arduino/quick-start.md#solución-de-problemas)
- **Flash falla** → [Sistema de Flash](./arduino/flasher.md#troubleshooting)
- **Errores de API** → [API Reference](./api/arduino-api.md#errores-comunes)
- **Problemas generales** → [README Principal](../README.md#diagnóstico-de-problemas)

## 📊 Diagramas y Referencias Visuales

- **Flujo de Comunicación** → [Arquitectura](./arduino/architecture.md#flujo-de-comunicación)
- **Flujo de Flash** → [Arquitectura](./arduino/architecture.md#flujo-de-flash-automático)
- **Componentes del Sistema** → [Arquitectura](./arduino/architecture.md#componentes-del-sistema)
- **Protocolo Serial** → [Arquitectura](./arduino/architecture.md#protocolo-serial)

## 🔗 Enlaces Externos

- [Arduino CLI Docs](https://arduino.github.io/arduino-cli/)
- [SerialPort Node.js](https://serialport.io/)
- [Socket.IO Docs](https://socket.io/docs/)
- [Express.js Guide](https://expressjs.com/es/guide/routing.html)

## 📝 Convenciones

- `código en línea` - Código, comandos o rutas
- **Negrita** - Términos importantes
- *Cursiva* - Énfasis
- → - Navegación o relación
- ✅ - Completado o disponible
- 🆕 - Nuevo o reciente
- ⚠️ - Advertencia importante

## 🔄 Actualizaciones

Este sistema de documentación se mantiene actualizado con cada cambio en el código. Si encuentras algo desactualizado, por favor verifica la fecha de última modificación en cada documento.

---

**Sistema SILAR v2.0.0** - Documentación actualizada
**DORA Lab** - 2024


