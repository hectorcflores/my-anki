# Validación de My Anki iOS

26 septiembre 2026. Implementación de desarrollo iniciada; todavía no es una entrega validada en el teléfono de Hector.

## Código y compilación

La licencia de Apple ya permite usar Xcode 27. El proyecto `ios/MyAnki/MyAnki.xcodeproj` resuelve Firebase 12.19.2 y Google Sign-In 10.0.0 mediante Swift Package Manager. Compilación Debug para iOS Simulator completada con firma desactivada. El mínimo provisional es iOS 17. Una compilación para simulador no prueba firma Personal Team, inicio de sesión ni funcionamiento real en iPhone.

La app implementa Show answer, Again/Hard/Good/Easy con intervalos, grupos de cinco con interludio y continuación automática, Hide/Undo, fecha disponible y almacenamiento atómico por cuenta. Hay una vista previa local aislada que nunca se sube a la cuenta. El código de autenticación y sincronización está integrado; los flujos reales todavía están pendientes.

Firebase tiene ahora una aplicación iOS `com.hectorcflores.myanki`, ID `1:178084388970:ios:7e248fdbc116ad111bea13`, en `my-anki-hector`. No se cambiaron reglas de Firestore, proveedores de la web ni el proyecto de Pomodoro. Se generó el esquema de retorno de Google a partir de la configuración oficial de esa aplicación.

El catálogo JSON contiene 98 libros y 1302 tarjetas elegibles con IDs únicos. Se publicó en `app/catalog.json` con commit `0b3363c`; la URL de GitHub Pages respondió HTTP 200 y su contenido coincidió con el archivo generado. La copia incluida y el archivo público salen de `app/data.js` mediante el mismo comando.

## Pruebas automatizadas comprobadas

El calendario Swift coincide con 124 resultados del JavaScript actual. Cubren las cuatro calificaciones, aprendizaje, reaprendizaje y repaso, ambos pasos, intervalos cortos/largos y suspensión por ocho fallos.

Pasan pruebas de reapertura del archivo persistente, esperas de Again, Hide/Undo sin alterar el calendario, contador diario, separación entre cuentas, rechazo de un archivo de otra cuenta y fallo de escritura sin pérdida del estado activo.

Pasan pruebas de reconstrucción desde eventos: una descarga repetida no duplica el repaso, una respuesta nueva durante la sincronización sigue pendiente, la visibilidad resuelve empates por ID y las importaciones conservan la pregunta e identidad publicadas. Se comprobó la normalización Unicode y que las posiciones numéricas procedentes de Firestore producen el mismo ID de tarjeta que la web.

Pasan pruebas REST con transporte simulado: petición al proyecto correcto, evento inmutable con `exists: false`, ID estable entre reintentos, comprobación de contenido ante conflicto 409, paginación y rechazo de cuota 429. Estos casos no prueban aceptación por las reglas de producción ni login real.

Pasa la suite completa de la web: siete archivos de pruebas sin fallos. No se modificó el código de estudio web.

Reproducir las pruebas nativas con `./tools/test-ios-core.sh` y las web con `node --test app/test/*.test.mjs`. El proyecto permite compilar el simulador con `CODE_SIGNING_ALLOWED=NO`; la instalación real requiere el Personal Team de Hector.

## Pendientes reales

El simulador iPhone 17 Pro con iOS 26.4 se quedó en el arranque de Apple; no se comprobó visualmente la app. Se creó otro simulador aislado «My Anki iPhone» con iOS 27, que seguía ejecutando la migración inicial de contenedores. No declarar validado el arranque ni Google Sign-In basándose en la compilación.

La Mac no detectó un iPhone físico conectado y `security find-identity -v -p codesigning` informó cero identidades válidas. Falta conectar el iPhone y configurar la cuenta Apple/Personal Team en Xcode, además de confirmar modelo e iOS. Estas acciones personales no pueden sustituirse por credenciales entregadas al asistente.

Falta iniciar sesión con la cuenta Google real y comprobar el mismo UID que la web, lectura de historial/importaciones y un repaso y Hide/Undo compartidos en ambos sentidos. Faltan modo avión, cierre durante envío, reconexión, cambio de cuenta, texto largo/Dynamic Type/VoiceOver, funcionamiento con la Mac apagada y renovación sobre la instalación conservando pendientes. El piloto de siete días aún no ha comenzado.

La primera sincronización lee el historial completo paginado; no inventa un cursor diferente al de la web. Los envíos de respuestas no necesitan releerlo completo. Medir el consumo de lecturas durante el piloto. Se conservan pendientes ante errores y se aplican reintentos limitados. La sincronización al recuperar conexión está implementada mediante el monitor de red, pero falta validarla en el teléfono.

La combinación de importaciones conserva el criterio de texto de la web, que aún puede colapsar textos iguales en distintas posiciones. No se cambió ese comportamiento para toda la biblioteca durante este portado; queda como limitación conocida que necesita una corrección coordinada y pruebas de compatibilidad.
