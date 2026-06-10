# Reporteador GCI

Plataforma web para gestionar solicitudes de reportes, controlar su ejecución operativa y habilitar consultas seguras sobre datos corporativos.

## Descripción general

`Reporteador GCI` es una aplicación orientada a entornos internos donde distintos usuarios necesitan solicitar reportes, monitorear su procesamiento y consultar información de negocio sin exponer acceso directo a la base de datos ni depender de ejecuciones manuales.

El proyecto está pensado para contextos operativos o administrativos en los que conviven necesidades de autoservicio, trazabilidad, control de permisos y ejecución desacoplada de procesos. En lugar de centralizar todo en scripts aislados, el sistema organiza la operación mediante una interfaz web, una API de negocio, una capa de persistencia y un worker dedicado a ejecutar trabajos en segundo plano.

## Objetivo del proyecto

El propósito principal es centralizar la gestión de reportes y consultas internas en una solución web controlada, auditable y extensible.

Dentro de un portafolio técnico, este proyecto demuestra capacidad para:

- Diseñar una arquitectura backend + worker para procesamiento asíncrono.
- Implementar autenticación y autorización con reglas de negocio reales.
- Construir una interfaz administrativa y operativa sin depender de frameworks pesados de frontend.
- Modelar procesos de negocio con estados, eventos, reintentos y trazabilidad.
- Integrar ejecución de procesos externos con control de concurrencia y monitoreo.

## Funcionalidades principales

### Gestión operativa de reportes

- Catálogo de reportes activos disponibles según permisos del usuario.
- Creación de solicitudes de ejecución con parámetros JSON.
- Asociación opcional de archivos de entrada por reporte.
- Monitoreo del estado de cada solicitud con progreso, mensajes y detalle histórico.
- Visualización de resultados operativos y rutas de salida configuradas.

### Ejecución asíncrona y control de procesos

- Cola de solicitudes desacoplada del frontend.
- Worker dedicado para tomar trabajos pendientes y ejecutar comandos externos.
- Registro de logs por solicitud.
- Reintentos automáticos configurables ante fallos.
- Heartbeat y liberación de locks para evitar colisiones entre workers.
- Restricción de ejecución por ventana horaria configurable.

### Seguridad y control de acceso

- Inicio de sesión con JWT.
- Cambio de contraseña desde la interfaz.
- Roles de usuario (`ADMIN`, `USER`).
- Restricción de visibilidad de reportes por equipos.
- Restricción de acceso a tablas consultables por equipos.

### Administración funcional

- CRUD de reportes.
- Gestión de carpetas permitidas por reporte.
- Administración de usuarios y restauración de contraseña temporal.
- Administración de equipos.
- Asignación de equipos a usuarios, reportes y tablas consultables.
- Configuración de ejemplos JSON para facilitar el uso de cada reporte.

### Consulta controlada de tablas

- Registro de tablas autorizadas mediante whitelist.
- Definición de columnas permitidas para filtros.
- Definición de columnas permitidas para resultados.
- Construcción dinámica de consultas con operadores controlados.
- Límite de resultados para proteger el uso operativo.

## Flujo general de funcionamiento

1. Un usuario inicia sesión en la aplicación web y el sistema valida credenciales mediante JWT.
2. La interfaz carga los reportes y tablas disponibles de acuerdo con los roles y equipos asignados.
3. El usuario crea una solicitud de reporte seleccionando un tipo de reporte, un archivo de entrada si aplica y parámetros en formato JSON.
4. La API registra la solicitud en base de datos con estado `EN_COLA` y genera eventos de trazabilidad.
5. Un worker en segundo plano toma la siguiente solicitud disponible, aplica mecanismos de lock para evitar conflictos y ejecuta el comando configurado para ese reporte.
6. Durante la ejecución, el worker actualiza progreso, escribe logs y mantiene heartbeat del lock.
7. Al finalizar, la solicitud queda en estado `OK` o `ERROR`; si corresponde, el sistema puede reencolar automáticamente el trabajo según la política de reintentos.
8. El usuario consulta desde el dashboard el avance, el historial de eventos y la información de salida.
9. En paralelo, los administradores pueden mantener catálogos, permisos, equipos, rutas y tablas consultables desde módulos dedicados.
10. Para consultas tabulares, el usuario selecciona una tabla permitida, define filtros dentro del whitelist y la API genera una consulta restringida sobre la base de datos.

## Arquitectura o estructura técnica

El proyecto sigue una arquitectura modular con separación clara entre interfaz, API, persistencia y procesamiento en background.

### Componentes principales

- `app/main.py`: concentra la API principal, los endpoints operativos y administrativos, y el montaje del frontend estático.
- `app/crud.py`: encapsula lógica transaccional y operaciones de persistencia para reportes, solicitudes, eventos y locks.
- `app/models.py` y `app/models_auth.py`: definen el modelo de datos de negocio, seguridad, equipos y tablas consultables.
- `app/routers/auth.py`: agrupa el flujo de autenticación.
- `app/deps_auth.py` y `app/security.py`: resuelven validación de token, roles y utilidades de seguridad.
- `app/templates/index.html`, `app/static/js/app.js`, `app/static/css/app.css`: implementan una SPA ligera en HTML, CSS y JavaScript vanilla.
- `worker/worker.py`: procesa la cola de trabajos, ejecuta comandos externos, registra logs, maneja reintentos y control de locks.
- `app/db_conn/engine.py`: abstrae la obtención del engine, contemplando tanto una conexión corporativa externa como una `DB_URL` configurable.
- `app/init_db.py`: inicializa tablas base, roles y un usuario administrador por defecto para arranque controlado.

### Enfoque arquitectónico

- Aplicación monolítica web con frontend estático servido por FastAPI.
- Persistencia relacional modelada con SQLAlchemy ORM.
- Procesamiento asíncrono resuelto mediante polling y worker desacoplado.
- Autorización multinivel basada en rol y pertenencia a equipos.
- Consultas dinámicas sobre tablas reales, protegidas por whitelist y validación de columnas.

## Tecnologías utilizadas

### Backend

- Python
- FastAPI
- SQLAlchemy 2
- Pydantic 2
- Uvicorn

### Frontend

- HTML5
- CSS3
- JavaScript vanilla

### Base de datos

- SQLAlchemy ORM sobre motor relacional configurable
- Compatibilidad explícita con escenarios Oracle
- Soporte de conexión vía `DB_URL` para otros motores compatibles

### Seguridad

- JWT
- Passlib con Argon2
- `python-multipart`

### Automatización y procesamiento

- Worker en Python para ejecución desacoplada
- `subprocess` para orquestación de comandos externos
- Logging por archivo en `runtime/worker_logs`

### Configuración y entorno

- `python-dotenv`
- Variables de entorno centralizadas

### Herramientas de desarrollo

- Git
- Estructura modular por capas

## Decisiones técnicas destacadas

- **Separación entre API y worker**: desacopla la experiencia del usuario del tiempo real de ejecución de los reportes y permite escalar el procesamiento de forma independiente.
- **Modelo de solicitudes con estados y eventos**: cada ejecución queda trazada con progreso, mensajes, fechas y bitácora de eventos, lo que mejora observabilidad y soporte operativo.
- **Control de concurrencia por locks de reporte**: evita que múltiples workers ejecuten simultáneamente procesos conflictivos sobre un mismo reporte.
- **Autorización combinada por roles y equipos**: no solo existe un rol administrador, sino una segmentación adicional por equipos para acotar qué reportes y tablas puede usar cada usuario.
- **Whitelist para consultas tabulares**: la aplicación no expone consultas libres; restringe tablas, columnas y operadores permitidos, reduciendo riesgo operativo y de seguridad.
- **Validaciones de configuración y payloads**: se normalizan JSON de ejemplo, fechas, tipos de filtros, extensiones de archivo y parámetros de entorno.
- **Compatibilidad con entorno corporativo**: la capa de conexión contempla el uso de un módulo externo de conexión además de una `DB_URL` estándar, lo que favorece portabilidad entre entornos.
- **Frontend sin dependencia de frameworks pesados**: la solución demuestra capacidad de construir una experiencia operativa completa con JavaScript vanilla, manteniendo control fino de comportamiento y estructura.

## Retos abordados

- Transformar ejecuciones de reportes basadas en comandos externos en un flujo web trazable y administrable.
- Diseñar una solución que combine autoservicio para usuarios finales con controles administrativos robustos.
- Resolver coordinación entre múltiples workers mediante locks, heartbeat y limpieza de bloqueos obsoletos.
- Habilitar consultas de datos útiles para negocio sin abrir acceso indiscriminado a tablas o columnas sensibles.
- Mantener la experiencia de operación simple desde el frontend, aun cuando el backend resuelve estados asíncronos, seguridad y reglas de acceso.
- Integrar necesidades reales de operación, como rutas permitidas, archivos de entrada, reintentos y ventanas horarias de ejecución.

## Capturas de pantalla

Carpeta sugerida para organizar evidencias visuales: `docs/screenshots/`

<!-- Screenshot pendiente: Pantalla de login -->
![Pantalla de login](docs/screenshots/login.png)

<!-- Screenshot pendiente: Dashboard principal con monitoreo de solicitudes -->
![Dashboard principal](docs/screenshots/dashboard-principal.png)

<!-- Screenshot pendiente: Modal de nueva solicitud con selección de reporte y parámetros JSON -->
![Nueva solicitud](docs/screenshots/nueva-solicitud.png)

<!-- Screenshot pendiente: Vista de detalle con línea de tiempo de eventos -->
![Detalle de solicitud](docs/screenshots/detalle-solicitud.png)

<!-- Screenshot pendiente: Módulo administrativo de reportes -->
![Administración de reportes](docs/screenshots/admin-reportes.png)

<!-- Screenshot pendiente: Módulo de consulta de tablas con filtros y resultados -->
![Consulta de tablas](docs/screenshots/consulta-tablas.png)

<!-- Screenshot pendiente: Módulo de equipos, usuarios o asignaciones -->
![Administración de equipos y usuarios](docs/screenshots/admin-equipos-usuarios.png)

## Demostración de valor

Este proyecto funciona como evidencia sólida de capacidades aplicadas a escenarios empresariales internos, especialmente en productos orientados a operación, automatización y control.

Demuestra experiencia en:

- Desarrollo backend con FastAPI y SQLAlchemy.
- Diseño de arquitectura para procesamiento desacoplado.
- Modelado de reglas de negocio con permisos, estados y trazabilidad.
- Integración de procesos externos dentro de una plataforma web.
- Construcción de interfaces operativas y administrativas completas.
- Procesamiento y validación de datos estructurados.
- Resolución de problemas reales vinculados con seguridad, concurrencia y mantenibilidad.

## Estado del proyecto

Por la cobertura funcional observada, el proyecto se comporta como una **versión funcional en evolución**, más cercana a un MVP operativo robusto que a un simple prototipo. Incluye interfaz de usuario, autenticación, administración, persistencia, ejecución en background y utilidades de soporte, aunque todavía admite evolución natural en aspectos de endurecimiento, despliegue y observabilidad avanzada.

## Posibles mejoras futuras

- Incorporar pruebas automatizadas de API, seguridad y flujos críticos del worker.
- Añadir métricas operativas y paneles de observabilidad.
- Implementar una cola dedicada o broker de mensajería si el volumen de ejecuciones creciera.
- Incorporar auditoría más detallada para acciones administrativas.
- Permitir descarga directa de resultados o integración con almacenamiento documental.
- Fortalecer gestión de secretos y políticas de configuración por ambiente.
- Agregar paginación y exportación ampliada para resultados de consulta tabular.

## Nota de portafolio

Este repositorio se presenta con fines demostrativos y profesionales, como evidencia de diseño técnico, desarrollo full stack orientado a procesos internos, automatización operativa e integración de reglas de negocio reales.
