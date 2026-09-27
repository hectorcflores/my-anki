# Plan: My Anki nativa para iPhone con instalación gratuita

Fecha: 26 de septiembre de 2026. Estado: implementación en marcha. La app SwiftUI, los repasos locales, el almacenamiento por cuenta y la integración de Google/Firebase están implementados y compilan para simulador. Pasan 124 casos de calendario y pruebas de persistencia y protocolo de sincronización. El catálogo JSON compartido ya está publicado. Todavía no se validaron el inicio de sesión real, la instalación en iPhone ni la renovación gratuita; faltan el teléfono conectado y la configuración de Personal Team. Ver evidencia y pendientes en `docs/ios-validation.md`. Sustituye la distribución por TestFlight del plan anterior.

## Objetivo y decisión

Crear una app privada de **My Anki** para el iPhone de Hector, con el diseño actual y el icono **myA**. Debe permitir estudiar con la Mac apagada, conservar el progreso sin internet y compartir tarjetas, repasos y tarjetas ocultas con el sitio.

Construir la interfaz nativa en SwiftUI y reutilizar el proyecto Firebase existente `my-anki-hector`. Instalar directamente desde Xcode en el iPhone de Hector con su cuenta Apple gratuita, seleccionando **Personal Team**. No usar TestFlight ni contratar Apple Developer. Este documento es la decisión vigente de distribución frente a las referencias anteriores de `roadmap.md`.

**El compromiso es el mantenimiento semanal:** Apple limita los perfiles gratuitos a siete días desde su emisión. Al vencer, la app puede dejar de abrir hasta volver a compilarla e instalarla desde Xcode con una autorización vigente. Renovaremos sobre la instalación existente, conservando equipo e identificador; no se debe borrar la app para renovar. Verificaremos que sobrevivan los datos locales. La Mac puede estar apagada durante el uso normal, pero hará falta para instalar y renovar. Esta opción es gratuita en firma e instalación, no libre de mantenimiento.

La app no obtiene highlights directamente de la aplicación Kindle. Los highlights ya entregados a la nube se pueden descargar y estudiar con la Mac apagada. Para capturar otros nuevos seguirá siendo necesaria la extensión de Chrome con una sesión válida de Amazon. No se promete acceso permanente a Amazon ni actualización continua de iOS en segundo plano.

## Punto de partida verificado

`app/index.html` contiene la interfaz, la selección de tarjetas, el calendario de repasos y la sincronización. `app/data.js` contiene el catálogo publicado; los lotes de la extensión se guardan en Firestore y se combinan con ese catálogo. `firestore.rules` controla el acceso por cuenta a `imports`, `reviews`, `visibility` y `meta`. `app/test/` contiene las pruebas actuales que deben seguir pasando.

La extensión 0.1.5 revisa seis libros al abrir Kindle Notebook o solicitar una sincronización. Eso no equivale a recorrer toda la biblioteca ni a ejecutarse automáticamente al abrir Chrome: en el código revisado todavía no hay alarmas periódicas ni un proceso completo de recuperación. Además, el Notebook muestra fechas de acceso; no debemos tratarlas como prueba de cuándo se creó cada highlight. La selección limitada a seis libros puede omitir novedades fuera de esa ventana.

Las fechas recuperadas del lector usan `modifiedTimestamp`. Debemos conservar esa procedencia y las fechas desconocidas; no sustituirlas por la fecha de importación ni prometer que un timestamp de modificación siempre equivale al instante de creación original. La última prueba de seis libros incluyó highlights sin fecha recuperada.

Estas limitaciones deben quedar visibles en el producto y en las pruebas. No impiden crear la app de estudio, pero sí impiden declarar terminada toda la automatización de Kindle.

## Experiencia de la primera versión

La pantalla principal conserva fondo oscuro, tipografía, tarjeta central, botón Show answer y controles Again, Hard, Good y Easy con su próximo intervalo. Incluye Hide card y Undo, la fecha disponible de cada highlight y estados comprensibles de sincronización. Se adapta a textos largos, tamaño de letra del sistema, VoiceOver y zonas seguras del iPhone.

Los bloques son de cinco respuestas, con el interludio de aproximadamente dos segundos y continuación automática. No son un límite diario. La regla actual reserva dos lugares para highlights no vistos, ordenados por fecha, y hasta tres para repasos vencidos; un grupo cubre los lugares disponibles del otro. Again y Hard respetan su espera. Una tarjeta antigua puede aparecer legítimamente como repaso.

El calendario actual es una implementación propia basada en SM-2 y pasos de aprendizaje de Anki. La app mantendrá ese comportamiento para conservar compatibilidad con la web; cambiar a FSRS o afirmar equivalencia total con Anki oficial queda fuera de esta entrega.

## Paso 1: preparar Apple y definir el contrato de datos

Comprobar versión de Xcode, SDK disponible y compatibilidad con el iPhone de Hector. En esta sesión Xcode había informado que su licencia estaba pendiente de aceptación; verificarlo antes de comenzar la compilación. Confirmar modelo y versión de iOS; Hector inicia sesión directamente en Xcode con su cuenta Apple y selecciona su Personal Team gratuito. Conectar el iPhone por cable, aceptar la confianza del dispositivo y habilitar Developer Mode si iOS lo requiere, incluyendo reinicio y confirmación en el teléfono. Elegir un identificador estable de la app, activar la firma automática y registrar la aplicación iOS en el mismo Firebase. No necesitamos App Store Connect.

Documentar en `docs/ios-data-contract.md` los identificadores de libros y tarjetas, las fechas, los eventos de repaso, las tarjetas ocultas, el estado inicial guardado y los cursores de sincronización. Conservar los identificadores existentes: son la unión entre una tarjeta y su historial. Definir cómo resolver coincidencias entre el catálogo publicado y las importaciones, incluyendo textos parecidos en posiciones distintas.

Resultado comprobable: una app mínima compila en simulador y se instala y abre en el iPhone con Personal Team, sin pago. Probar temprano Google Sign-In y Firebase en esa instalación para detectar capacidades de firma incompatibles antes de construir toda la app. Si una dependencia requiere una capacidad no disponible en Personal Team, ajustar esa dependencia o informar el bloqueo; no activar una membresía de pago automáticamente. El contrato debe describir cómo recuperar la cuenta existente sin crear otra biblioteca ni reiniciar los repasos.

## Paso 2: construir la app local

Crear el proyecto en `ios/MyAnki/`, con áreas pequeñas para modelos, almacenamiento, calendario de repasos, sincronización y pantallas. Usar SwiftUI y almacenamiento persistente local compatible con la versión mínima de iOS acordada. Separar datos por cuenta y guardar cada respuesta antes de intentar enviarla a la nube.

Implementar primero el diseño y los repasos con datos de prueba. Portar a Swift las reglas actuales y compararlas con casos producidos por el código JavaScript real: mismos identificadores, fechas, calificaciones e intervalos. Cubrir el ajuste aleatorio determinista de intervalos, cambios de día y zona horaria, tarjetas ocultas y esperas de aprendizaje. Añadir esos casos compartidos en `app/test/fixtures/` y pruebas de iOS en `ios/MyAnkiTests/`.

Resultado comprobable: la app completa bloques de cinco, muestra los intervalos correctos y conserva el progreso después de cerrarse y abrirse sin conexión. Una respuesta revelada no desaparece si llegan datos nuevos durante el repaso.

## Paso 3: conectar la cuenta y sincronizar

Configurar Google Sign-In para iOS y Firebase Authentication siguiendo la documentación oficial. Comprobar que Hector recibe el mismo identificador de usuario que en la web. El primer inicio de sesión y la primera descarga requieren internet; los siguientes repasos pueden funcionar con los datos guardados.

Proporcionar un catálogo JSON versionado a partir de la misma fuente que genera `app/data.js`, sin mantener dos catálogos manuales ni ejecutar JavaScript remoto en iOS. La app descarga ese catálogo y combina los lotes privados de `imports`. Mantiene la última copia válida si la descarga falla o llega incompleta.

Reutilizar el protocolo de eventos existente: guardar localmente una cola de envíos pendientes, reintentar con los mismos identificadores y confirmar recepción antes de retirarlos. Recuperar el estado inicial y reproducir los repasos en el mismo orden que la web. Verificar expresamente timestamps del servidor y cursores: la web usa `createTime` como referencia en partes del protocolo, por lo que el cliente iOS no debe sustituirlo silenciosamente por otro campo.

Sincronizar al abrir la app, volver a ella y recuperar conexión, con reintentos limitados. La actualización en segundo plano será una mejora posterior; iOS decide cuándo puede ejecutarse. Ante cuota agotada, conservar los cambios pendientes y mostrar que aún no están enviados.

Resultado comprobable: un repaso y una tarjeta ocultada desde el iPhone aparecen en la web, y viceversa. Repetir un envío no duplica eventos. Una instalación limpia recupera todo lo que llegó a la nube. Los cambios offline aún no enviados no pueden recuperarse tras desinstalar la app; el estado debe indicarlo claramente.

## Paso 4: comprobar el flujo completo en el iPhone

Validar en un dispositivo real un highlight identificable desde Amazon hasta la extensión, Firestore y la app. Comparar texto, libro, identificador y fecha disponible. Repetir la importación y actualizar el catálogo para comprobar que no desaparece ni se duplica.

Probar repasos en modo avión, cierre de la app antes de enviar, reconexión, uso simultáneo de web e iPhone, cambio de cuenta y actualización de la app. Confirmar que los cambios del iPhone no afectan el proyecto Firebase de Pomodoro.

Separar dos estados: **progreso de estudio sincronizado** y **última entrega de Kindle**. El primero no demuestra que Amazon esté actualizado. Usar la hora de los lotes recibidos para la segunda señal; si no hay información compartida sobre la sesión de Amazon, no inventar un estado de conexión.

Resultado comprobable: registrar en `docs/ios-validation.md` las pruebas realizadas, versión y dispositivo, resultados y cualquier pendiente. Una pantalla verde o una compilación exitosa por sí solas no cuentan como validación completa.

## Paso 5: instalar la versión de uso diario desde Xcode

Preparar el icono myA y una compilación Release firmada con el Personal Team ya validado. Instalar desde Xcode usando el mismo identificador de la prueba inicial. Desconectar el cable y el depurador, cerrar y volver a abrir la app desde el icono del iPhone. Confirmar que funciona con la Mac apagada y con los datos descargados en modo avión.

Registrar la fecha real de vencimiento del perfil usado, cuando pueda verificarse; no calcularla únicamente como siete días después de instalar. Si iOS solicita confiar en el desarrollador, Hector completa esa acción directamente en Ajustes. No entregar contraseñas ni certificados privados a terceros.

Resultado comprobable: Hector abre la app desde su iPhone sin Xcode conectado, ve su biblioteca y completa un repaso que aparece en la web al recuperar internet. Una compilación que solo funciona en el simulador no cumple este paso.

## Paso 6: renovar sin perder datos y completar el piloto

Documentar en `docs/ios-free-install.md` una rutina breve: abrir el proyecto en Xcode, conectar el iPhone, seleccionar el mismo Personal Team y dispositivo, y ejecutar Run para compilar e instalar sobre la app existente. La primera versión usa renovación manual; no promete renovación silenciosa ni añade servicios de firma de terceros.

Planificar la renovación antes de vencer, idealmente alrededor del día seis. Comprobar primero que los cambios pendientes llegaron a la nube cuando sea posible. Conservar el mismo identificador de la app y equipo de firma; no desinstalar ni borrar el almacenamiento como parte de la renovación. Si la autorización ya venció, intentar primero renovar sobre la instalación existente y verificar la recuperación de los datos.

Probar una actualización sobre la app instalada con un repaso offline pendiente: después de actualizar, ese repaso debe seguir local y enviarse exactamente una vez al reconectar. Validar también la renovación real del perfil al acercarse a su vencimiento; no afirmar que se probó esa caducidad únicamente por reinstalar dos veces el mismo día ni cambiar el reloj del teléfono para simularla.

El piloto debe abarcar al menos un ciclo de siete días y una renovación, incluyendo sesiones offline y highlights de días distintos. Registrar resultados en `docs/ios-validation.md`. Puede entregarse una primera instalación funcional antes, pero la validación del mantenimiento semanal queda pendiente hasta observar ese ciclo.

Conservar la web como alternativa si vence la instalación durante un viaje o sin acceso a la Mac. La web tendrá solo los repasos que ya llegaron a la nube. No crear recordatorios ni automatizaciones en esta etapa de planificación; definirlos por separado si Hector los solicita.

## Modelo recomendado para implementar

Usar **GPT-6 Sol con razonamiento Medium por defecto** para construir las pantallas, preparar el proyecto de Xcode, documentar la instalación y realizar las tareas habituales. OpenAI describe Sol como un modelo orientado a programación compleja en su [documentación oficial](https://developers.openai.com/api/docs/models/gpt-6-sol). Esta elección es una recomendación para el proyecto, no una garantía de menor consumo total: las correcciones también consumen recursos.

Usar **Sol High** para definir y validar la sincronización, conservar los identificadores y el historial de las tarjetas, mantener el comportamiento de los repasos y guardar y recuperar respuestas sin conexión. Incluir en esta fase las pruebas de recuperación y de renovación de la instalación sin pérdida de datos. Son las partes donde un error puede afectar el progreso guardado del usuario.

Reservar **GPT-6 Astra** como opción para errores difíciles que Sol no consiga diagnosticar o una revisión independiente de riesgos concretos. No repetir automáticamente toda la implementación con otro modelo. Seleccionar el modelo y el nivel de razonamiento en Codex antes de la fase correspondiente; este documento no cambia esa configuración.

La elección del modelo no sustituye la validación: exigir pruebas en el iPhone real y evidencia de sincronización con la web. No declarar terminada la app solamente porque el código compila; la instalación, el uso sin conexión y la renovación sin pérdida de datos deben cumplir los criterios de este plan.

## Qué necesitaré de Hector

Confirmar el modelo de iPhone y su versión de iOS, disponer de un cable compatible para la primera conexión e iniciar sesión directamente en Xcode con su cuenta Apple gratuita. Completar en el teléfono las confirmaciones de confianza y Developer Mode que aparezcan, y aceptar los acuerdos de Apple que correspondan. No hace falta contratar Apple Developer ni instalar TestFlight.

Al finalizar, abrir My Anki en el teléfono y realizar un repaso de prueba. Después deberá tener acceso a la Mac para renovar aproximadamente cada semana. El asistente puede preparar el proyecto y ayudar con Xcode, pero no puede prometer operar automáticamente el iPhone ni evitar confirmaciones de Apple. No hace falta entregar contraseñas de Apple, Google o Amazon al asistente.

## Alcance, costo y criterio final

La primera entrega incluye estudio, login, sincronización, modo offline, fechas disponibles e instalación directa gratuita desde Xcode. No incluye App Store pública, Apple Watch, widgets, notificaciones push, un nuevo algoritmo de memoria ni eliminar la dependencia de Chrome para captar highlights. La recuperación automática completa de la extensión permanece como trabajo aparte en `roadmap.md`.

No se requiere contratar otro servidor para este diseño. Firebase se reutiliza dentro de los límites disponibles y se mide el consumo; no se promete costo cero indefinido. La cuenta Personal Team no requiere membresía de pago para esta instalación personal. Se asume que Hector ya dispone de Mac e iPhone compatibles. El compromiso adicional es el tiempo de renovación semanal.

La estimación anterior de tres a siete días no se considera validada. Reestimar después del paso 1 y de comprobar la compatibilidad del calendario y la sincronización. No hay envío a revisión beta de Apple para esta ruta. La primera instalación depende de la firma y las confirmaciones del dispositivo; validar la renovación semanal requiere observar el paso del tiempo.

El objetivo se cumple cuando Hector puede instalar gratis desde Xcode, estudiar con la Mac apagada, conservar respuestas offline y recuperar en web e iPhone el mismo progreso después de sincronizar. También debe quedar probada y documentada una renovación del perfil sin pérdida de datos. La implementación ya comenzó. El siguiente paso que requiere a Hector es conectar el iPhone y configurar Personal Team en Xcode; después se deben validar login y sincronización reales. El piloto y la renovación semanal siguen pendientes.

## Fuentes oficiales consultadas

La instalación personal gratuita y el vencimiento de los perfiles a los siete días se documentan en [Apple: Choosing a Membership](https://developer.apple.com/support/compare-memberships/). La preparación del teléfono está en [Apple: Enabling Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) y la instalación desde Xcode en [Apple: Run an app on a device](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html). La integración de cuenta se basa en [Firebase: Google Sign-In on Apple platforms](https://firebase.google.com/docs/auth/ios/google-signin).
