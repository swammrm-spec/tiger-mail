$statePath = "$env:LOCALAPPDATA\Tiger.mail\persistent-state.json"
$raw = Get-Content $statePath -Raw
$state = $raw | ConvertFrom-Json

$existing = $state.tables.user_mail_settings[0]

$accounts = @(
    @{
        id = 1
        user_id = 1
        company_name = "TECHNO GROUP"
        display_name = "M. Safadi"
        email_address = "m.safad@audit.techno-grp.com"
        account_type = "POP3"
        incoming_server = "pop.emailarray.com"
        incoming_port = 995
        incoming_ssl = $true
        outgoing_server = "smtp.emailarray.com"
        outgoing_port = 465
        outgoing_encryption = "SSL/TLS"
        smtp_auth_required = $true
        smtp_same_as_incoming = $true
        username = "m.safad@audit.techno-grp.com"
        password = "Admin@123"
        remember_password = $true
        require_spa = $false
        leave_copy_on_server = $true
        remove_after_days = 14
        remove_when_deleted = $true
        auto_send_receive_minutes = 9
        default_priority = "Normal"
        default_sensitivity = "Normal"
        default_read_receipt = $false
        default_delivery_receipt = $false
        signature = ""
        updated_at = "2026-07-04T00:00:00.000Z"
        created_at = "2026-07-04T00:00:00.000Z"
    },
    @{
        id = 4
        user_id = 4
        company_name = "TECHNO GROUP"
        display_name = "Ahmad Kamal"
        email_address = "ahmad.kamal@techno-grp.com"
        account_type = "POP3"
        incoming_server = "pop.emailarray.com"
        incoming_port = 995
        incoming_ssl = $true
        outgoing_server = "smtp.emailarray.com"
        outgoing_port = 465
        outgoing_encryption = "SSL/TLS"
        smtp_auth_required = $true
        smtp_same_as_incoming = $true
        username = "ahmad.kamal@techno-grp.com"
        password = "Aa@2024@@!@#"
        remember_password = $true
        require_spa = $false
        leave_copy_on_server = $true
        remove_after_days = 14
        remove_when_deleted = $true
        auto_send_receive_minutes = 9
        default_priority = "Normal"
        default_sensitivity = "Normal"
        default_read_receipt = $false
        default_delivery_receipt = $false
        signature = ""
        updated_at = "2026-07-04T00:00:00.000Z"
        created_at = "2026-07-04T00:00:00.000Z"
    },
    @{
        id = 5
        user_id = 5
        company_name = "TECHNO GROUP"
        display_name = "M. Safadi"
        email_address = "m.safadi@techno-grp.com"
        account_type = "POP3"
        incoming_server = "pop.emailarray.com"
        incoming_port = 995
        incoming_ssl = $true
        outgoing_server = "smtp.emailarray.com"
        outgoing_port = 465
        outgoing_encryption = "SSL/TLS"
        smtp_auth_required = $true
        smtp_same_as_incoming = $true
        username = "m.safadi@techno-grp.com"
        password = "Aa@2024@@!@#"
        remember_password = $true
        require_spa = $false
        leave_copy_on_server = $true
        remove_after_days = 14
        remove_when_deleted = $true
        auto_send_receive_minutes = 9
        default_priority = "Normal"
        default_sensitivity = "Normal"
        default_read_receipt = $false
        default_delivery_receipt = $false
        signature = ""
        updated_at = "2026-07-04T00:00:00.000Z"
        created_at = "2026-07-04T00:00:00.000Z"
    }
)

$state.tables.user_mail_settings = $accounts
$state | ConvertTo-Json -Depth 10 | Set-Content $statePath -Encoding UTF8

Write-Host "Wrote user_mail_settings with $($accounts.Count) entries"
