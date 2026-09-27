# Instalar My Anki gratis en el iPhone

Esta instalación personal usa Xcode y tu cuenta Apple gratuita. No requiere TestFlight. Apple limita la autorización gratuita a siete días: habrá que renovarla desde la Mac. El uso normal y los repasos offline no necesitan la Mac encendida.

Abre `ios/MyAnki/MyAnki.xcodeproj` en Xcode. En Xcode → Settings → Accounts, inicia sesión directamente con tu cuenta Apple. No compartas la contraseña con el asistente. Conecta el iPhone por cable y acepta «Confiar» en el teléfono si aparece. Si Xcode indica que falta Developer Mode, actívalo en Ajustes → Privacidad y seguridad → Modo de desarrollador y completa el reinicio y confirmación que pida iOS.

En el proyecto MyAnki, selecciona el target MyAnki → Signing & Capabilities. Mantén Automatically manage signing y el identificador `com.hectorcflores.myanki`. Selecciona tu Personal Team. Después elige tu iPhone como destino y pulsa Run. Si Apple exige cambiar el identificador porque no está disponible, detener la instalación y ajustar también la aplicación iOS registrada en Firebase y su OAuth; no cambiar solamente un campo.

Abre la app desde el icono myA. Inicia sesión con la misma cuenta Google de la web. Primero debe descargarse el historial; no empezar a calificar la vista local como si ya fuera la biblioteca conectada. Comprobar un repaso y Hide/Undo en ambos dispositivos antes de tratarla como versión de uso diario.

Para renovar, vuelve a ejecutar Run sobre la instalación existente con el mismo identificador y Personal Team. No borres la app. Procura sincronizar pendientes antes de renovar. Los cambios offline pendientes viven en el teléfono: desinstalar puede borrarlos. Verificar que siguen presentes después de renovar, incluso si todavía no hay internet.

Estado: instrucciones preparadas. La instalación en teléfono, la compatibilidad real con Personal Team, el vencimiento del perfil y una renovación semanal aún no se han probado. Registrar las fechas reales y resultados en `docs/ios-validation.md`.
