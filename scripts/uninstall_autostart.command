#!/bin/bash
# Stop the Hidden service and remove automatic start at login.
LABEL="com.thetrivials.hidden"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "Hidden stopped."
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" && echo "Automatic start removed."
