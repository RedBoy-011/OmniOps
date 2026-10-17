package com.omniops.coucou;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public class OmniOpsApp extends Application {
    public static final String CHANNEL_COMMANDS = "omniops_commands";
    public static final String CHANNEL_SERVICE = "omniops_service";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                // High priority channel for critical approvals
                NotificationChannel cmdChannel = new NotificationChannel(
                    CHANNEL_COMMANDS,
                    getString(R.string.channel_commands_name),
                    NotificationManager.IMPORTANCE_HIGH
                );
                cmdChannel.setDescription(getString(R.string.channel_commands_desc));
                cmdChannel.enableVibration(true);
                nm.createNotificationChannel(cmdChannel);

                // Ongoing low-noise channel for Coucou floating companion service
                NotificationChannel srvChannel = new NotificationChannel(
                    CHANNEL_SERVICE,
                    getString(R.string.channel_service_name),
                    NotificationManager.IMPORTANCE_LOW
                );
                srvChannel.setDescription(getString(R.string.channel_service_desc));
                nm.createNotificationChannel(srvChannel);
            }
        }
    }
}
