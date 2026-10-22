Name:           fedora-workstation-config
Version:        1.0.0
Release:        1%{?dist}
Summary:        Automated workstation setup and state synchronization suite for Fedora GNOME
License:        MIT
URL:            https://github.com/MehulK-techie/fedora-workstation-config
Source0:        https://github.com/MehulK-techie/fedora-workstation-config/archive/refs/heads/main.tar.gz

BuildArch:      noarch
Requires:       git
Requires:       curl
Requires:       dconf
Requires:       flatpak
Requires:       python3-pip
Requires:       v4l-utils

%description
An automated Infrastructure-as-Code suite for Fedora Linux providing zero-touch
system provisioning, low-latency desktop keybindings, privacy-safe browser profile
synchronization, and local IR facial biometrics.

%prep
%autosetup -n fedora-workstation-config-main

%install
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}%{_datadir}/%{name}

# Install executable scripts
install -m 0755 setup.sh %{buildroot}%{_bindir}/fedora-workstation-setup
install -m 0755 sync.sh %{buildroot}%{_bindir}/fedora-workstation-sync

# Copy reference configs
cp -r zen-config %{buildroot}%{_datadir}/%{name}/ 2>/dev/null || true
cp -r extensions %{buildroot}%{_datadir}/%{name}/ 2>/dev/null || true

%files
%license LICENSE
%doc README.md
%{_bindir}/fedora-workstation-setup
%{_bindir}/fedora-workstation-sync
%{_datadir}/%{name}

%changelog
* Thu Oct 22 2026 Mehul Kumar <mehulk@fedora.org> - 1.0.0-1
- Initial stable release for Fedora COPR submission
