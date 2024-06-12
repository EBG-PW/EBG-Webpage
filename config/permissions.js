/*
    app_permissions: List all permissions that are native to the application itself.
    All those permissions do not have a read or write part.
    However all those permissions need read & write to be true in order for a user to get them granted!

    There are 2 groups in the panel, reg and member. For example for the events and activities.
    This needs to be represented by a group.member permission. This will grand the member check for the group.
*/

module.exports = {
    "app_permissions": [
        "app.web.login",
        "app.web.logout"
    ],
    // The default groups are used for event/activity permissions. The code will check the inheritance tree until it hits one of the 2 default groups.
    "default_group": "user",
    "default_member_group": "member",
    "groups": {
        "app": {
            "permissions": [
                "app.web.login",
                "app.web.logout",
            ],
            "inherit": []
        },
        // The user group is the default group for all users. This group is granted to new users.
        "user": {
            "permissions": [
                "group.user",
                "web.event.*",
                "web.user.*",
                "app.user.settings.*",
                "app.event.user.*"
            ],
            "inherit": [
                "app"
            ]
        },
        // The member group is the default group for party members.
        "member": {
            "permissions": [
                "group.member",
                "web.event.*",
                "web.user.*",
                "app.user.settings.*",
                "app.event.user.*"
            ],
            "inherit": [
                "app"
            ]
        },
        // The party leader groups, all derived from basic admin group.
        "kassierer": {
            "permissions": [
            ],
            "inherit": [
                "admin"
            ],
            "is_team": true
        },
        "schriftführer": {
            "permissions": [
            ],
            "inherit": [
                "admin"
            ],
            "is_team": true
        },
        "obmann": {
            "permissions": [
            ],
            "inherit": [
                "admin"
            ],
            "is_team": true
        },
        // The admin group is the default group for administrators.
        "admin": {
            "permissions": [
                "service.*",
                "app.admin.*",
            ],
            "inherit": [
                "member"
            ]
        },
        // The root group with general permissions.
        "root": {
            "permissions": [
                "*"
            ],
            "inherit": []
        }
    }
}