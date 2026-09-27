# Contrato de datos iOS — primera versión

La única base de producción es Firebase `my-anki-hector`, raíz `my_anki/{uid}`. El UID debe ser el mismo de Google/Firebase usado en la web. No usar el proyecto de Pomodoro ni crear una biblioteca separada. La firma Apple no identifica la cuenta de estudio.

El catálogo se genera desde `app/data.js` con `node tools/export-ios-catalog.mjs`. Produce `app/catalog.json` para publicación y una copia incluida en iOS desde la misma fuente, con `schemaVersion: 1`. Cualquier actualización del catálogo debe ejecutar este comando antes de publicar. Los identificadores de highlight son las claves de tarjeta existentes de 16 caracteres hexadecimales; nunca regenerarlos desde el texto. Libros y highlights conservan sus campos actuales. `aligned: false` excluye del estudio.

La combinación actual de `imports` en `deckWithKindleImports` compara título normalizado y texto normalizado/prefijo; todavía no distingue posiciones. Si hay coincidencia se conserva el ID y pregunta publicados; solo se enriquecen fecha, nota y página disponibles. Riesgo pendiente: textos iguales en posiciones distintas pueden colapsarse. Antes de conectar iOS se debe definir un criterio compartido con la web que use posiciones disponibles sin romper los IDs existentes, y probarlo. No inventar fecha cuando falta. `highlightedAt` tiene la procedencia del catálogo/importación; `modifiedTimestamp` no garantiza creación original. La fecha de entrega de Kindle se muestra separada de la sincronización de estudio.

`reviews/{eventId}` es un evento inmutable: `cardId`, `grade` entero 0–3 (Again, Hard, Good, Easy), `reviewedAt` timestamp del dispositivo, `clientId` estable y `createdAt` timestamp del servidor. El ID del evento se crea una sola vez antes de guardarlo localmente y se reutiliza en reintentos. Un documento ya existente cuenta como recibido solo después de comprobar que pertenece al mismo evento. No escribir campos adicionales: las reglas los rechazan.

`visibility/{eventId}` guarda `id`, `cardId`, `hidden`, `at` en milisegundos y `createdAt` del servidor. Ocultar conserva la tarjeta y el historial. Undo publica un nuevo evento; no borra el anterior. Resolver el estado en el mismo orden que la web, incluyendo desempates.

`meta/baseline` y documentos `baseline_*` guardan `state`, `takenAt`, `createdAt`. El estado por tarjeta contiene `st`, `step`, `ef`, `ivl`, `due`, `reps`, `lapses`, y opcionalmente `intro`, `leech`, `__lastReviewAt`. Los tiempos de estado son milisegundos Unix. Reproducir el historial por `reviewedAt` y luego ID del documento; la web omite eventos con tiempo menor o igual a `__lastReviewAt`. Mantener esta compatibilidad durante el portado; no cambiar silenciosamente el criterio.

La referencia incremental de la web usa el `createTime` del documento devuelto por Firestore REST, no el momento de descarga ni solamente `reviewedAt`. El SDK nativo no expone ese metadato de la misma forma. Antes de integrar la nube, decidir y probar una lectura REST compatible o una recuperación completa paginada del historial. No sustituir el cursor por un campo distinto sin pruebas cruzadas.

Guardar localmente por UID el catálogo válido, eventos recibidos, estado inicial, eventos pendientes y visibilidad. Guardar cada respuesta y su evento pendiente en una sola operación persistente antes de mostrar la siguiente tarjeta. Recalcular el estado usando eventos confirmados y pendientes sin duplicarlos. Solo quitar pendientes después de confirmación del servidor. Un fallo de escritura local debe mantener la tarjeta actual y mostrar el error.

No mezclar caché ni cola entre cuentas. Una sesión offline usa exclusivamente la última cuenta autenticada; cambiar o cerrar sesión con envíos pendientes requiere conservarlos bajo su UID. No subirlos con la siguiente cuenta. No eliminar almacenamiento ni desinstalar para renovar la firma.

Estado: contrato basado en el código actual; integración de Firebase, autenticación real y compatibilidad entre dispositivos todavía pendientes de pruebas. La primera pantalla local de desarrollo no debe anunciar sincronización ni escribir eventos de producción.
