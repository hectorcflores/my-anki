# My Anki para iPhone

Proyecto SwiftUI en `MyAnki/MyAnki.xcodeproj`, mínimo provisional iOS 17. Firebase y Google Sign-In se resuelven con Swift Package Manager y versiones fijadas en el proyecto. El archivo GoogleService-Info identifica únicamente `my-anki-hector`; no contiene contraseñas ni claves de cuenta de servicio.

La vista previa antes de iniciar sesión usa un almacenamiento separado que nunca se sube a la cuenta. Al iniciar sesión con Google, la app cambia al almacenamiento por UID y descarga el historial existente antes de permitir un primer repaso de cuenta. Guarda respuestas y eventos juntos mediante una escritura atómica; los reintentos reutilizan los IDs. Sign out conserva los archivos locales de esa cuenta y sus pendientes.

La primera versión de sincronización recupera el historial completo con paginación al abrir, volver a la app o reconectar; no implementa un cursor diferente al de la web. Las respuestas envían solamente la cola pendiente para evitar releer toda la biblioteca con cada botón. La lectura completa tiene un costo de lecturas que deberá medirse en el piloto antes de optimizarla. Los fallos conservan los pendientes y hay tres reintentos limitados. Las cuotas requieren seguir manteniendo la copia local.

El catálogo se genera desde `app/data.js` con `node tools/export-ios-catalog.mjs`, incluyendo una copia local y `app/catalog.json`. Publicar este último con la web para actualizar el catálogo remoto. Ante descarga inválida o fallida se conserva la última copia válida. Las importaciones privadas se recuperan de Firestore para la cuenta correspondiente.

Ejecutar `./tools/test-ios-core.sh` desde la raíz verifica el calendario frente a 124 casos del JavaScript actual, persistencia, aislamiento de cuenta, replay, visibilidad, identidad de importación y el protocolo REST con transporte simulado. No sustituye Google Sign-In real, las reglas de Firestore en producción ni las pruebas en el iPhone.

La instalación y renovación gratuitas se describen en `docs/ios-free-install.md`. La evidencia y los pendientes están en `docs/ios-validation.md`. Compilar no equivale a haber instalado ni validado la app en un teléfono.
